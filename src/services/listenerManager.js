import { Zalo, ThreadType } from 'zca-js';
import { listActiveSessions, setAccountIdBySessionKey, deleteSessionByKey } from '../repositories/session.repository.js';
import { saveIncomingMessage } from '../repositories/message.repository.js';
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

  const zalo = new Zalo({ checkUpdate: false, selfListen: true });
  let api;
  try {
    const cookieLen = Array.isArray(cookie) ? cookie.length : (cookie || '').length;
    console.log('[Listener] login for', accKey, 'cookie.len=', cookieLen, Array.isArray(cookie) ? '(array)' : '(string)');
    api = await zalo.login({ cookie, imei, userAgent: user_agent, language: language || 'vi' });
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn('[Listener] login error for', accKey, msg);
    
    // Check if this is an authentication failure (user logged in elsewhere)
    const isAuthFailure = msg.includes('authentication') || 
                         msg.includes('unauthorized') || 
                         msg.includes('invalid') ||
                         msg.includes('expired') ||
                         msg.includes('login') ||
                         msg.toLowerCase().includes('auth') ||
                         msg.includes('Đăng nhập thất bại') ||
                         msg.includes('Cookie not in this host') ||
                         msg.includes('domain');
    
    if (isAuthFailure) {
      console.warn('[Listener] authentication failure detected, deactivating session:', session_key);
      try {
        await deleteSessionByKey(session_key);
        console.log('[Listener] session deactivated due to auth failure:', session_key);
      } catch (deleteErr) {
        console.error('[Listener] failed to deactivate session:', session_key, deleteErr.message);
      }
      // Don't retry for auth failures - user needs to login again
      await releaseLock(lockKey);
      return;
    }
    
    // For other errors, release lock and retry later (backoff 10s)
    await releaseLock(lockKey);
    setTimeout(() => startListenerForSession(sessionRow).catch(console.error), 10000);
    return;
  }

  // Ensure we know our own account_id (uid)
  let accId = account_id;
  if (!accId) {
    try {
      accId = await api.getOwnId();
      if (accId) {
        await setAccountIdBySessionKey(session_key, String(accId));
        console.log('[Listener] populated account_id for session', session_key, '=>', accId);
      }
    } catch (e) {
      console.warn('[Listener] getOwnId failed:', e?.message || String(e));
    }
  }

  api.listener.on('message', async (message) => {
    try {
      const d = message?.data || {};
      const isText = typeof d.content === 'string';
      const isPhoto = d.msgType === 'chat.photo' && typeof d.content === 'object' && d.content !== null;
      
      if (!isText && !isPhoto) {
        console.log('[Listener] skip unsupported message', {
          type: message?.type,
          msgType: d.msgType,
          hasContent: typeof d.content,
          keys: Object.keys(d || {}),
        });
        return;
      }

      // Map fields from zca-js payload
      const fromUid = d.uidFrom || d.senderId || null; // người gửi
      const toUid = d.idTo || d.userId || d.groupId || null; // đích đến
      const msgId = d.msgId || d.messageId || `${Date.now()}-${Math.random()}`;
      
      // Handle content based on message type
      let content;
      if (isText) {
        content = d.content;
      } else if (isPhoto) {
        // For photo messages, store the image URL and metadata
        content = JSON.stringify({
          type: 'photo',
          href: d.content.href,
          thumb: d.content.thumb,
          title: d.content.title || '',
          description: d.content.description || '',
          params: d.content.params || '',
          width: d.content.params ? JSON.parse(d.content.params || '{}').width : null,
          height: d.content.params ? JSON.parse(d.content.params || '{}').height : null,
        });
      }
      
      const msgType = d.msgType || d.type || null;
      const cmd = typeof d.cmd !== 'undefined' ? Number(d.cmd) : null;
      const ts = d.ts ? Number(d.ts) : null;
      const threadId = message?.threadId || d.threadId || null;

      // Suy luận peer_id
      // - Group: nếu không có d.groupId thì dùng threadId khi type === 1 (group)
      // - 1-1: dùng 'đối phương' làm peer_id (out -> toUid, in -> fromUid)
      const inferredGroupId = d.groupId || (d.type === 1 ? (threadId || null) : null);
      const isGroup = !!inferredGroupId || d.type === 1 || message?.type === 1;
      const threadType = isGroup ? ThreadType.Group : ThreadType.User;
      const direction = (fromUid && accId && String(fromUid) === String(accId)) ? 'out' : 'in';
      const peerId = isGroup
        ? (threadId || inferredGroupId)
        : (direction === 'out' ? (toUid || d.idTo || d.userId || null) : (fromUid || d.uidFrom || d.senderId || null));

      // Fetch group info if this is a group message
      let groupName = null;
      if (isGroup && (threadId || inferredGroupId)) {
        try {
          const gid = threadId || inferredGroupId;
          const groupInfo = await api.getGroupInfo(gid);
          if (groupInfo?.gridInfoMap?.[gid]?.name) {
            groupName = groupInfo.gridInfoMap[gid].name;
            console.log('[Listener] fetched group name:', groupName, 'for groupId:', gid);
          }
        } catch (groupErr) {
          console.warn('[Listener] failed to fetch group info for', threadId || inferredGroupId, ':', groupErr?.message || groupErr);
        }
      }

      console.log('[Listener] message received', {
        session_key,
        account_id: accId || account_id,
        direction,
        peerId,
        msgId,
        msgType,
      });

      await saveIncomingMessage({
        session_key,
        account_id: accId || account_id,
        // New Zalo message fields
        type: d.type,
        thread_id: threadId,
        id_to: d.idTo,
        uid_from: d.uidFrom,
        d_name: d.dName, // Keep sender name in d_name
        group_name: groupName, // Store group name separately
        is_self: message?.isSelf,
        content,
        msg_type: d.msgType,
        property_ext: d.propertyExt,
        quote: d.quote,
        mentions: d.mentions,
        attachments_json: message?.data?.attachments || null,
        ts: d.ts,
        msg_id: d.msgId,
        cli_msg_id: d.cliMsgId,
        global_msg_id: d.globalMsgId,
        real_msg_id: d.realMsgId,
        cmd: d.cmd,
        st: d.st,
        status: d.status,
        ttl: d.ttl,
        notify: d.notify,
        top_out: d.topOut,
        top_out_time_out: d.topOutTimeOut,
        top_out_impr_time_out: d.topOutImprTimeOut,
        action_id: d.actionId,
        uin: d.uin,
        user_id: d.userId,
        params_ext: d.paramsExt,
        raw_json: message,
        // Legacy compatibility fields
        thread_type: threadType,
        peer_id: String(peerId || ''),
        direction,
        message_id: String(msgId),
        from_uid: fromUid ? String(fromUid) : null,
        to_uid: toUid ? String(toUid) : null,
      });

      // No outbound POST. Dangbai will fetch via GET /api/messages
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
