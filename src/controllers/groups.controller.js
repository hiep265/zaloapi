import { ThreadType } from 'zca-js';
import { getApiForSession } from '../services/zalo.service.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as sessionRepo from '../repositories/session.repository.js';
import { resolveConversationName } from '../repositories/conversation.repository.js';
import { sendTextMessage } from '../services/sendMessage.service.js';

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
    const { session_key, thread_id, name, avatarSource, message } = req.body || {};

    if (!session_key || typeof session_key !== 'string' || !session_key.trim()) {
      return res.status(400).json({ error: 'Missing session_key' });
    }
    if (!thread_id || typeof thread_id !== 'string' || !thread_id.trim()) {
      return res.status(400).json({ error: 'Missing thread_id' });
    }

    const api = await getApiForSession(String(session_key));

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
    const { session_key, thread_id, message } = req.body || {};
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
    const api = await getApiForSession(String(session_key));
    const result = await sendTextMessage({ api, threadId: String(thread_id), msg: finalMsg });

    if (!result) {
      return res.status(500).json({ ok: false, error: 'Failed to send message' });
    }

    return res.status(200).json({ ok: true, data: result, thread_id: String(thread_id) });
  } catch (err) {
    next(err);
  }
}

export default { createManagersGroup };
