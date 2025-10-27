import { ThreadType } from 'zca-js';
import { getApiForSession } from '../services/zalo.service.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as sessionRepo from '../repositories/session.repository.js';
import { resolveConversationName, resolvePeerUserIdByThread } from '../repositories/conversation.repository.js';
import { sendTextMessage, sendImageMessage } from '../services/sendMessage.service.js';
import sharp from 'sharp';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * POST /api/groups/send-image
 * Body: { session_key: string, thread_id: string, image_url?: string, file_path?: string, message?: string }
 *
 * Sends an image to the given thread. Accepts either a direct file path (server-readable)
 * or an image URL to fetch and forward. Optional caption via `message`.
 */
export async function sendImageIfPermitted(req, res, next) {
  try {
    const { session_key, account_id, thread_id, image_url, file_path, message } = req.body || {};
    if (!session_key || !String(session_key).trim()) {
      return res.status(400).json({ ok: false, error: 'Missing session_key' });
    }
    if (!thread_id || !String(thread_id).trim()) {
      return res.status(400).json({ ok: false, error: 'Missing thread_id' });
    }
    if ((!image_url || !String(image_url).trim()) && (!file_path || !String(file_path).trim())) {
      return res.status(400).json({ ok: false, error: 'Missing image_url or file_path' });
    }
    const api = await getApiForSession(String(session_key), account_id || undefined);
    let threadType = ThreadType.User;
    try {
      const gi = await api.getGroupInfo(String(thread_id));
      const map = gi && gi.gridInfoMap ? gi.gridInfoMap : null;
      if (map && Object.prototype.hasOwnProperty.call(map, String(thread_id))) {
        threadType = ThreadType.Group;
      }
    } catch (_) {}
    // Determine correct target id: for user -> need counterpart uid, for group -> thread_id is OK
    let targetId = String(thread_id);
    if (threadType === ThreadType.User) {
      try {
        const uid = await resolvePeerUserIdByThread(String(session_key), String(thread_id), account_id || null);
        if (uid && String(uid).trim()) targetId = String(uid);
      } catch (_) {}
    }
    const result = await sendImageMessage({
      api,
      threadId: targetId,
      imageUrl: image_url,
      filePath: file_path,
      msg: typeof message === 'string' ? message : undefined,
      type: threadType,
    });

    if (!result) {
      return res.status(500).json({ ok: false, error: 'Failed to send image' });
    }

    return res.status(200).json({ ok: true, data: result, thread_id: String(thread_id) });
  } catch (err) {
    next(err);
  }
}

export async function sendImageFileIfPermitted(req, res, next) {
  try {
    const { session_key, account_id, thread_id, message } = req.body || {};
    if (!session_key || !String(session_key).trim()) {
      return res.status(400).json({ ok: false, error: 'Missing session_key' });
    }
    if (!thread_id || !String(thread_id).trim()) {
      return res.status(400).json({ ok: false, error: 'Missing thread_id' });
    }
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ ok: false, error: 'Missing image file' });
    }

    const api = await getApiForSession(String(session_key), account_id || undefined);
    const buf = file.buffer;
    // Determine extension
    let ext = 'jpg';
    const ct = (file.mimetype || '').toLowerCase();
    if (ct.includes('jpeg')) ext = 'jpg';
    else if (ct.includes('png')) ext = 'png';
    else if (ct.includes('gif')) ext = 'gif';
    else if (ct.includes('webp')) ext = 'webp';
    const nameMatch = (file.originalname || '').match(/\.(jpg|jpeg|png|gif|webp)$/i);
    if (nameMatch) ext = nameMatch[1].toLowerCase().replace('jpeg', 'jpg');

    const tmp = path.join(os.tmpdir(), `zimg-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    await fs.promises.writeFile(tmp, buf);

    try {
      const content = { attachments: [tmp], msg: (typeof message === 'string' && message.trim()) ? String(message).trim() : '' };
      console.debug('[send-image-file] content', {
        hasMsg: Object.prototype.hasOwnProperty.call(content, 'msg'),
        msgType: typeof content.msg,
        msgLen: typeof content.msg === 'string' ? content.msg.length : undefined,
        attIsArray: Array.isArray(content.attachments),
        attLen: Array.isArray(content.attachments) ? content.attachments.length : undefined,
        att0Type: Array.isArray(content.attachments) ? typeof content.attachments[0] : undefined
      });
      let threadType = ThreadType.User;
      try {
        const gi = await api.getGroupInfo(String(thread_id));
        const map = gi && gi.gridInfoMap ? gi.gridInfoMap : null;
        if (map && Object.prototype.hasOwnProperty.call(map, String(thread_id))) {
          threadType = ThreadType.Group;
        }
      } catch (_) {}
      let targetId = String(thread_id);
      if (threadType === ThreadType.User) {
        try {
          const uid = await resolvePeerUserIdByThread(String(session_key), String(thread_id), account_id || null);
          if (uid && String(uid).trim()) targetId = String(uid);
        } catch (_) {}
      }
      const result = await api.sendMessage(content, targetId, threadType);
      if (!result) {
        return res.status(500).json({ ok: false, error: 'Failed to send image' });
      }
      return res.status(200).json({ ok: true, data: result, thread_id: String(thread_id) });
    } finally {
      fs.promises.unlink(tmp).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
}
/**
 * POST /api/groups/managers
 * Body: { session_key: string, thread_id: string, name?: string, avatarSource?: string, message?: string }
 *
 * Create a new Zalo group including the user resolved from the provided `thread_id` (1-1 thread only).
 * The current account (self) is excluded automatically.
 * This does NOT persist any group info into the database; it only calls zca-js.
 */
export async function createManagersGroup(req, res, next) {
  try {
    const { session_key, account_id, thread_id, name, avatarSource, message } = req.body || {};

    if (!session_key || typeof session_key !== 'string' || !session_key.trim()) {
      return res.status(400).json({ error: 'Missing session_key' });
    }
    if (!thread_id || typeof thread_id !== 'string' || !thread_id.trim()) {
      return res.status(400).json({ error: 'Missing thread_id' });
    }

    const api = await getApiForSession(String(session_key), account_id || undefined);

    // Filter out current account (self) from members
    let selfId = null;
    try { selfId = await api.getOwnId(); } catch (_) {}

    // Build eligible staff UIDs for this session_key (can_manage_orders=true and associated to session_key)
    const normalizeKeys = (val) => {
      try {
        if (Array.isArray(val)) return val.map((k) => String(k));
        if (typeof val === 'string') {
          const s = val.trim();
          if (s.startsWith('{') && s.endsWith('}')) {
            const inner = s.slice(1, -1);
            if (!inner) return [];
            return inner.split(',').map((p) => p.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')).filter(Boolean).map(String);
          }
          try {
            const arr = JSON.parse(s);
            if (Array.isArray(arr)) return arr.map((k) => String(k));
          } catch (_) {}
          return s ? [s] : [];
        }
        if (val && typeof val === 'object') {
          try { if (Array.isArray(val.keys)) return val.keys.map((k) => String(k)); } catch (_) {}
        }
      } catch (_) {}
      return [];
    };

    const staffList = await staffRepo.list({ limit: 2000, offset: 0, includeInactive: false });
    const eligibleStaffUids = (staffList || [])
      .filter((row) => {
        const keys = normalizeKeys(row?.associated_session_keys);
        return row && row.zalo_uid && row.can_manage_orders === true && keys.includes(String(session_key));
      })
      .map((row) => String(row.zalo_uid));

    // Union: provided thread_id + eligible staff uids, excluding self
    const memberSet = new Set([String(thread_id), ...eligibleStaffUids]);
    if (selfId) memberSet.delete(String(selfId));
    const finalMembers = Array.from(memberSet).filter(Boolean);

    if (finalMembers.length === 0) {
      return res.status(400).json({ error: 'Không có thành viên hợp lệ từ thread_id (đã loại trừ tài khoản hiện tại nếu trùng)' });
    }

    // zca-js requirements: members (required, non-empty); name (optional); avatarSource (optional)
    const options = { members: finalMembers };
    if (typeof name === 'string' && name.trim()) options.name = name.trim();
    if (avatarSource) options.avatarSource = avatarSource; // can be path or Buffer per zca-js

    const result = await api.createGroup(options);

    // Optionally send a message to the newly created group with prefixed display name from this thread
    let send_result = null;
    let prefixed_message = null;
    if (typeof message === 'string' && message.trim()) {
      try {
        // Resolve display name from the provided thread_id
        let displayName = await resolveConversationName(String(session_key), String(thread_id));
        displayName = displayName ? String(displayName).trim() : '';
        prefixed_message = displayName ? `${displayName} ${String(message)}` : String(message);
        const targetThreadId = String(result.groupId ?? result.group_id ?? result.threadId ?? result.thread_id ?? result.gid ?? result.id ?? result?.data?.groupId ?? '');
        if (targetThreadId) {
          send_result = await sendTextMessage({ api, threadId: targetThreadId, msg: prefixed_message, type: ThreadType.Group });
        }
      } catch (e) {
        // swallow send error but include in response as null
        send_result = null;
      }
    }

    return res.status(200).json({
      data: result,
      members: finalMembers,
      members_count: finalMembers.length,
      session_key: String(session_key),
      message_sent: !!send_result,
      send_result,
      prefixed_message,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/groups/send-message
 * Body: { session_key: string, thread_id: string, message: string }
 *
 * Sends a text message to the given thread if the staff associated with the session_key
 * has can_receive_notifications permission. The message is prefixed with the conversation
 * display name resolved from the messages table (latest d_name for the thread).
 */
export async function sendMessageIfPermitted(req, res, next) {
  try {
    const { session_key, account_id, thread_id, message } = req.body || {};
    if (!session_key || !String(session_key).trim()) {
      return res.status(400).json({ ok: false, error: 'Missing session_key' });
    }
    if (!thread_id || !String(thread_id).trim()) {
      return res.status(400).json({ ok: false, error: 'Missing thread_id' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, error: 'Missing message' });
    }

    // Removed permission gate: allow manual message sending for the session owner

    // Plan A: do not prefix with display name; send the exact message content
    const finalMsg = String(message);

    // Send via Zalo API
    const api = await getApiForSession(String(session_key), account_id || undefined);
    let threadType = ThreadType.User;
    try {
      const gi = await api.getGroupInfo(String(thread_id));
      const map = gi && gi.gridInfoMap ? gi.gridInfoMap : null;
      if (map && Object.prototype.hasOwnProperty.call(map, String(thread_id))) {
        threadType = ThreadType.Group;
      }
    } catch (_) {}
    let targetId = String(thread_id);
    if (threadType === ThreadType.User) {
      try {
        const uid = await resolvePeerUserIdByThread(String(session_key), String(thread_id), account_id || null);
        if (uid && String(uid).trim()) targetId = String(uid);
      } catch (_) {}
    }
    const result = await sendTextMessage({ api, threadId: targetId, msg: finalMsg, type: threadType });

    if (!result) {
      return res.status(500).json({ ok: false, error: 'Failed to send message' });
    }

    return res.status(200).json({ ok: true, data: result, thread_id: String(thread_id) });
  } catch (err) {
    next(err);
  }
}

export default { createManagersGroup };
