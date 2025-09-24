import { getApiForSession } from '../services/zalo.service.js';
import * as staffRepo from '../repositories/staff.repository.js';

/**
 * POST /api/groups/managers
 * Body: { session_key: string, members: string[], name?: string, avatarSource?: string }
 *
 * Create a new Zalo group with the provided member IDs, but only include those
 * who are staff with can_manage_orders=true and are associated with the given session_key.
 * The current account (self) is excluded automatically.
 * This does NOT persist any group info into the database; it only calls zca-js.
 */
export async function createManagersGroup(req, res, next) {
  try {
    const { session_key, members, name, avatarSource } = req.body || {};

    if (!session_key || typeof session_key !== 'string' || !session_key.trim()) {
      return res.status(400).json({ error: 'Missing session_key' });
    }

    const api = await getApiForSession(String(session_key));

    // Normalize input members (optional). We allow empty list; staff will be added automatically.
    const requested = Array.isArray(members)
      ? members.map((m) => (m != null ? String(m).trim() : '')).filter(Boolean)
      : [];

    // Filter out current account (self) from members
    let selfId = null;
    try { selfId = await api.getOwnId(); } catch (_) {}

    const uniqueRequested = Array.from(new Set(requested))
      .filter((uid) => uid && (!selfId || String(uid) !== String(selfId)));

    // Helper to normalize associated_session_keys from DB (can be array, JSON text, or Postgres array string like "{a,b}")
    const normalizeKeys = (val) => {
      try {
        if (Array.isArray(val)) {
          return val.map((k) => String(k));
        }
        if (typeof val === 'string') {
          const s = val.trim();
          // Postgres array string: {val1,val2}
          if (s.startsWith('{') && s.endsWith('}')) {
            const inner = s.slice(1, -1);
            if (!inner) return [];
            return inner
              .split(',')
              .map((p) => p.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
              .filter(Boolean)
              .map(String);
          }
          // Try JSON array string
          try {
            const arr = JSON.parse(s);
            if (Array.isArray(arr)) return arr.map((k) => String(k));
          } catch (_) {}
          // Fallback: single value string
          return s ? [s] : [];
        }
        // Try JSON-like object with keys
        if (val && typeof val === 'object') {
          try {
            if (Array.isArray(val.keys)) return val.keys.map((k) => String(k));
          } catch (_) {}
        }
      } catch (_) {}
      return [];
    };

    // Build eligible staff list for this session_key (active, can_manage_orders=true, has zalo_uid, associated with session_key)
    const staffList = await staffRepo.list({ limit: 2000, offset: 0, includeInactive: false });
    const eligibleStaffUids = (staffList || [])
      .filter((row) => {
        const keys = normalizeKeys(row?.associated_session_keys);
        return row && row.zalo_uid && row.can_manage_orders === true && keys.includes(String(session_key));
      })
      .map((row) => String(row.zalo_uid));

    // Merge: eligible staff UIDs + requested members, exclude self
    const mergedSet = new Set([...eligibleStaffUids, ...uniqueRequested]);
    if (selfId) mergedSet.delete(String(selfId));
    const finalMembers = Array.from(mergedSet).filter(Boolean);

    if (finalMembers.length === 0) {
      return res.status(400).json({ error: 'Không có thành viên hợp lệ sau khi hợp nhất nhân viên và members (đã loại trừ tài khoản hiện tại)' });
    }

    // zca-js requirements: members (required, non-empty); name (optional); avatarSource (optional)
    const options = { members: finalMembers };
    if (typeof name === 'string' && name.trim()) options.name = name.trim();
    if (avatarSource) options.avatarSource = avatarSource; // can be path or Buffer per zca-js

    const result = await api.createGroup(options);
    return res.status(200).json({ data: result, members: finalMembers, members_count: finalMembers.length, session_key: String(session_key) });
  } catch (err) {
    next(err);
  }
}

export default { createManagersGroup };
