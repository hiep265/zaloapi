import db from '../db/index.js';

// Resolve display name strictly from messages table by session_key and thread_id
export async function resolveConversationName(session_key, thread_id) {
  const res = await db.query(
    `SELECT d_name
     FROM messages
     WHERE session_key = $1 AND thread_id = $2 AND d_name IS NOT NULL
     ORDER BY ts DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
    [session_key, thread_id]
  );
  const row = res.rows[0] || null;
  const name = (row?.d_name || '').toString().trim();
  return name || null;
}

// Resolve counterpart user uid for a given thread_id (1-1 conversation only).
// Returns null for group threads or when cannot be resolved.
export async function resolvePeerUserIdByThread(session_key, thread_id) {
  const res = await db.query(
    `SELECT peer_id, thread_id, thread_type, uid_from, id_to, direction
     FROM messages
     WHERE session_key = $1 AND thread_id = $2
     ORDER BY ts DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
    [session_key, thread_id]
  );
  const row = res.rows[0] || null;
  if (!row) return null;
  // Infer 1-1 if peer_id is different from thread_id; in group, peer_id equals thread_id
  const isOneToOne = row.peer_id && row.thread_id && String(row.peer_id) !== String(row.thread_id);
  if (!isOneToOne) return null;
  // Prefer peer_id which is normalized as counterpart uid for user threads
  const candidate = row.peer_id || (row.direction === 'out' ? row.id_to : row.uid_from) || null;
  return candidate ? String(candidate) : null;
}

export default {
  resolveConversationName,
  resolvePeerUserIdByThread,
};
