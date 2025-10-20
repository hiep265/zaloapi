import { ThreadType } from 'zca-js';
import sharp from 'sharp';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Send a plain text message via an existing zca-js API instance.
 * Keep this reusable for any place that needs to send a message.
 *
 * @param {Object} params
 * @param {import('zca-js').ZCAApi} params.api - The logged-in API instance (from zalo.login())
 * @param {string} params.threadId - User or Group ID to send to
 * @param {string} params.msg - Message text
 * @param {ThreadType} [params.type=ThreadType.User] - Thread type (User/Group)
 * @returns {Promise<import('zca-js').SendMessageResponse|null>} response or null on error
 */
export async function sendTextMessage({ api, threadId, msg, type = ThreadType.User }) {
  if (!api || typeof api.sendMessage !== 'function') {
    console.warn('[sendMessage] invalid api instance or sendMessage not available');
    return null;
  }
  if (!threadId || !msg) {
    console.warn('[sendMessage] missing threadId or msg');
    return null;
  }
  try {
    const content = { msg: String(msg) };
    const res = await api.sendMessage(content, String(threadId), type);
    return res || null;
  } catch (e) {
    console.error('[sendMessage] failed to send message:', e?.message || String(e));
    return null;
  }
}

/**
 * Send a link message via an existing zca-js API instance.
 *
 * @param {Object} params
 * @param {import('zca-js').ZCAApi} params.api - The logged-in API instance
 * @param {string} params.threadId - User or Group ID to send to
 * @param {string} params.link - URL to send
 * @param {string} [params.msg] - Optional message text to accompany the link
 * @param {ThreadType} [params.type=ThreadType.User] - Thread type (User/Group)
 * @returns {Promise<import('zca-js').SendLinkResponse|null>} response or null on error
 */
export async function sendLink({ api, threadId, link, msg, type = ThreadType.User }) {
  if (!api || typeof api.sendLink !== 'function') {
    console.warn('[sendLink] invalid api instance or sendLink not available');
    return null;
  }
  if (!threadId || !link) {
    console.warn('[sendLink] missing threadId or link');
    return null;
  }
  try {
    const options = {
      link: String(link),
      ...(msg ? { msg: String(msg) } : {})
    };
    const res = await api.sendLink(options, String(threadId), type);
    return res || null;
  } catch (e) {
    console.error('[sendLink] failed to send link:', e?.message || String(e));
    return null;
  }
}

/**
 * Send text message via Dangbai backend FastAPI (forwards to zaloapi).
 * Requires backend to accept Bearer JWT and optional X-API-Key.
 *
 * @param {Object} opts
 * @param {string} opts.threadId
 * @param {string} opts.msg
 * @param {string} [opts.apiBaseUrl=process.env.DANGBAI_BASE_URL||'http://localhost:8000']
 * @param {string} [opts.apiKey=process.env.DANGBAI_API_KEY]
 * @param {string} [opts.bearer=process.env.DANGBAI_BEARER]
 * @returns {Promise<object|null>} response json or null
 */
export async function sendTextViaDangbaiBackend({ threadId, msg, apiBaseUrl, apiKey, bearer } = {}) {
  try {
    const base = apiBaseUrl || process.env.DANGBAI_BASE_URL || 'http://localhost:8000';
    const url = `${base.replace(/\/$/, '')}/api/v1/zalo/send-message`;
    const headers = { 'Content-Type': 'application/json' };
    const xKey = apiKey || process.env.DANGBAI_API_KEY;
    if (xKey) headers['X-API-Key'] = xKey;
    const token = bearer || process.env.DANGBAI_BEARER;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ thread_id: String(threadId || ''), message: String(msg || '') })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`sendTextViaDangbaiBackend failed ${res.status}: ${text}`);
    }
    return await res.json().catch(() => ({}));
  } catch (e) {
    console.error('[sendMessage] sendTextViaDangbaiBackend error:', e?.message || String(e));
    return null;
  }
}

export async function sendImageMessage({ api, threadId, filePath, imageUrl, msg, type = ThreadType.User }) {
  if (!api || typeof api.sendMessage !== 'function') {
    console.warn('[sendImageMessage] invalid api instance or sendMessage not available');
    return null;
  }
  if (!threadId) {
    console.warn('[sendImageMessage] missing threadId');
    return null;
  }
  try {
    let attachments = [];
    let tmpToCleanup = null;
    try {
      if (filePath && String(filePath).trim()) {
        attachments = [String(filePath)];
      } else if (imageUrl && String(imageUrl).trim()) {
        const urlStr = String(imageUrl).trim();
        const res = await fetch(urlStr);
        if (!res.ok) throw new Error(`fetch image failed ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        // Infer extension
        const contentType = res.headers.get('content-type') || '';
        let ext = 'jpg';
        if (contentType.includes('jpeg')) ext = 'jpg';
        else if (contentType.includes('png')) ext = 'png';
        else if (contentType.includes('gif')) ext = 'gif';
        else if (contentType.includes('webp')) ext = 'webp';
        try {
          const u = new URL(urlStr);
          const pn = path.basename(u.pathname || '');
          const m = pn.match(/\.(jpg|jpeg|png|gif|webp)$/i);
          if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
        } catch {}
        const tmp = path.join(os.tmpdir(), `zimg-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
        await fs.promises.writeFile(tmp, buf);
        tmpToCleanup = tmp;
        attachments = [tmp];
      } else {
        console.warn('[sendImageMessage] missing filePath or imageUrl');
        return null;
      }
      const content = { attachments, msg: (msg && String(msg).trim()) || '' };
      const res = await api.sendMessage(content, String(threadId), type);
      return res || null;
    } finally {
      if (tmpToCleanup) {
        fs.promises.unlink(tmpToCleanup).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[sendImageMessage] failed to send image:', e?.message || String(e));
    return null;
  }
}

export default { sendTextMessage, sendLink, sendTextViaDangbaiBackend, sendImageMessage };
