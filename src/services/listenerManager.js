import { Zalo, ThreadType } from 'zca-js';
import { listActiveSessions } from '../repositories/session.repository.js';
import { saveIncomingMessage } from '../repositories/message.repository.js';
import { postToDangbai } from '../utils/dangbaiClient.js';
import { acquireLock, releaseLock } from '../utils/lock.js';

const activeListeners = new Map(); // account_id -> { api, stop, session_key }

function extractCookie(cookies_json) {
  if (!cookies_json) return null;
  try {
    // Helper: build header from array of { key, value }
    const buildFromArray = (arr) => {
      try {
        const parts = (arr || [])
          .filter((it) => it && typeof it.key === 'string' && typeof it.value === 'string')
          .map((it) => `${it.key}=${it.value}`);
        return parts.length ? parts.join('; ') : null;
      } catch { return null; }
    };
    // Case 0: Buffer/Uint8Array returned by driver
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(cookies_json)) {
      const text = cookies_json.toString('utf8');
      try {
        const obj = JSON.parse(text);
        if (Array.isArray(obj)) return obj; // prefer native array for zca-js
        if (obj && typeof obj.cookie === 'string' && obj.cookie.trim()) return obj.cookie;
        if (obj && typeof obj.cookies === 'string' && obj.cookies.trim()) return obj.cookies;
      } catch {
        if (text && text.trim()) return text.trim();
      }
    }
    // Some drivers may give Uint8Array
    if (typeof cookies_json === 'object' && cookies_json && cookies_json.constructor && cookies_json.constructor.name === 'Uint8Array') {
      const text = Buffer.from(cookies_json).toString('utf8');
      try {
        const obj = JSON.parse(text);
        if (Array.isArray(obj)) return obj; // prefer native array
        if (obj && typeof obj.cookie === 'string' && obj.cookie.trim()) return obj.cookie;
        if (obj && typeof obj.cookies === 'string' && obj.cookies.trim()) return obj.cookies;
      } catch {
        if (text && text.trim()) return text.trim();
      }
    }
    // Case 1: stored as JSON text string
    if (typeof cookies_json === 'string') {
      try {
        const obj = JSON.parse(cookies_json);
        if (Array.isArray(obj)) {
          return obj;
        }
        if (obj && typeof obj.cookie === 'string' && obj.cookie.trim()) return obj.cookie;
        if (obj && typeof obj.cookies === 'string' && obj.cookies.trim()) return obj.cookies;
        // If JSON parse ok but no known key, fall through
      } catch {
        // Not JSON text; maybe it is already the raw cookie string
        if (cookies_json.trim()) return cookies_json.trim();
      }
    }
    // Case 2: stored as JSONB object via pg -> driver returns object
    if (typeof cookies_json === 'object' && cookies_json !== null) {
      if (Array.isArray(cookies_json)) {
        return cookies_json;
      }
      if (typeof cookies_json.cookie === 'string' && cookies_json.cookie.trim()) return cookies_json.cookie;
      if (typeof cookies_json.cookies === 'string' && cookies_json.cookies.trim()) return cookies_json.cookies;
      // Some drivers may wrap inside { cookie: { value: '...' } }
      if (cookies_json.cookie && typeof cookies_json.cookie.value === 'string') return cookies_json.cookie.value;
    }
    return null;
  } catch (e) {
    console.warn('[Listener] extractCookie error:', e.message);
    return null;
  }
}

export async function startAllListeners() {
  const sessions = await listActiveSessions();
  console.log('[Listener] starting for active sessions:', sessions.length);
  for (const s of sessions) {
    try {
      await startListenerForSession(s);
    } catch (e) {
      console.error('[Listener] failed to start for', s.session_key, e.message);
    }
  }
}

export async function startListenerForSession(sessionRow) {
  const { session_key, account_id, cookies_json, imei, user_agent, language } = sessionRow;
  const cookie = extractCookie(cookies_json);
  if (!cookie) {
    // avoid printing full cookie_json; print type and keys to debug shape
    const shape = cookies_json ? (typeof cookies_json === 'string' ? 'string' : `object keys: ${Object.keys(cookies_json||{}).join(',')}`) : 'null';
    console.warn('[Listener] missing cookie for', session_key, 'cookies_json shape:', shape);
    return;
  }

  const accKey = account_id || session_key;
  const lockKey = `zalo:listener:account:${accKey}`;
  const locked = await acquireLock(lockKey, 30);
  if (!locked) {
    console.log('[Listener] lock busy skip', accKey);
    return;
  }

  if (activeListeners.has(accKey)) {
    await releaseLock(lockKey);
    console.log('[Listener] already running', accKey);
    return;
  }

  const zalo = new Zalo({ checkUpdate: false });
  let api;
  try {
    const cookieLen = Array.isArray(cookie) ? cookie.length : (cookie || '').length;
    console.log('[Listener] login for', accKey, 'cookie.len=', cookieLen, Array.isArray(cookie) ? '(array)' : '(string)');
    api = await zalo.login({ cookie, imei, userAgent: user_agent, language: language || 'vi' });
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn('[Listener] login error for', accKey, msg);
    // Release lock and retry later (backoff 10s)
    await releaseLock(lockKey);
    setTimeout(() => startListenerForSession(sessionRow).catch(console.error), 10000);
    return;
  }

  api.listener.on('message', async (message) => {
    try {
      const isText = typeof message?.data?.content === 'string';
      if (!isText) return;

      const threadType = message.type; // ThreadType.User / ThreadType.Group
      const peerId = message?.data?.senderId || message?.data?.groupId || null;
      const content = message.data.content;
      const msgId = message?.data?.messageId || `${Date.now()}-${Math.random()}`;

      await saveIncomingMessage({
        session_key,
        account_id,
        thread_type: threadType,
        peer_id: String(peerId || ''),
        content,
        message_id: String(msgId),
        attachments_json: message?.data?.attachments || null,
      });

      await postToDangbai('/api/v1/zalo/messages/incoming', {
        session_key,
        account_id,
        thread_type: threadType,
        peer_id,
        content,
        message_id: msgId,
      });
    } catch (err) {
      console.error('[Listener] handle message error', err.message || err);
    }
  });

  api.listener.on('stop', async () => {
    console.warn('[Listener] stopped', accKey);
    activeListeners.delete(accKey);
    await releaseLock(lockKey);
    setTimeout(() => startListenerForSession(sessionRow).catch(console.error), 5000);
  });

  api.listener.start();
  activeListeners.set(accKey, { api, stop: () => api.listener.stop(), session_key });
  console.log('[Listener] started', accKey);
}

export function listRunning() {
  return Array.from(activeListeners.keys());
}

export async function stopListener(accountIdOrSessionKey) {
  const h = activeListeners.get(accountIdOrSessionKey);
  if (h) {
    try { h.stop(); } catch {}
    activeListeners.delete(accountIdOrSessionKey);
  }
}

export default { startAllListeners, startListenerForSession, listRunning, stopListener };
