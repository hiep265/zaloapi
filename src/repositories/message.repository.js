import db from '../db/index.js';

export async function saveIncomingMessage({
  session_key,
  account_id,
  thread_type,
  peer_id,
  content,
  message_id,
  attachments_json,
  direction = 'in',
}) {
  const res = await db.query(
    `INSERT INTO messages(session_key, account_id, thread_type, peer_id, direction, content, attachments_json, message_id)
     VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (session_key, message_id) DO NOTHING
     RETURNING id`,
    [
      session_key,
      account_id || null,
      thread_type || null,
      peer_id || null,
      direction || 'in',
      content || null,
      attachments_json ? JSON.stringify(attachments_json) : null,
      message_id || null,
    ]
  );
  return res.rows[0]?.id || null;
}

export default {
  saveIncomingMessage,
};
