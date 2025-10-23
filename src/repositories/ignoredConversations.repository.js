import db from '../db/index.js';

export async function list({ session_key, owner_account_id = null, thread_id, user_id, limit = 50, offset = 0 } = {}) {
  const filters = [];
  const values = [];
  let idx = 1;

  if (session_key) { filters.push(`session_key = $${idx++}`); values.push(session_key); }
  if (owner_account_id !== null && owner_account_id !== undefined) { filters.push(`owner_account_id = $${idx++}`); values.push(owner_account_id); }
  if (thread_id)  { filters.push(`thread_id = $${idx++}`); values.push(thread_id); }
  if (user_id)    { filters.push(`user_id = $${idx++}`); values.push(user_id); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const sql = `
    SELECT id, session_key, owner_account_id, user_id, thread_id, name, created_at, updated_at
    FROM ignored_conversations
    ${where}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT $${idx++} OFFSET $${idx}
  `;
  values.push(limit, offset);

  const res = await db.query(sql, values);
  return res.rows;
}

export async function getById(id) {
  const res = await db.query(
    `SELECT id, session_key, owner_account_id, user_id, thread_id, name, created_at, updated_at
     FROM ignored_conversations
     WHERE id = $1 LIMIT 1`,
    [id]
  );
  return res.rows[0] || null;
}

export async function getByKey({ session_key, owner_account_id = null, thread_id }) {
  const res = await db.query(
    `SELECT id, session_key, owner_account_id, user_id, thread_id, name, created_at, updated_at
     FROM ignored_conversations
     WHERE session_key = $1 AND ($2::text IS NULL OR owner_account_id = $2) AND thread_id = $3
     LIMIT 1`,
    [session_key, owner_account_id, thread_id]
  );
  return res.rows[0] || null;
}

export async function upsert({ session_key, owner_account_id = null, thread_id, name = null, user_id = null }) {
  const res = await db.query(
    `INSERT INTO ignored_conversations(session_key, owner_account_id, thread_id, name, user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_key, owner_account_id, thread_id)
     DO UPDATE SET name = COALESCE(EXCLUDED.name, ignored_conversations.name),
                   user_id = COALESCE(EXCLUDED.user_id, ignored_conversations.user_id),
                   updated_at = NOW()
     RETURNING id, session_key, owner_account_id, user_id, thread_id, name, created_at, updated_at`,
    [session_key, owner_account_id, thread_id, name, user_id]
  );
  return res.rows[0];
}

export async function updateById(id, { name, user_id }) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
  if (user_id !== undefined) { fields.push(`user_id = $${idx++}`); values.push(user_id); }

  if (fields.length === 0) {
    return await getById(id);
  }

  fields.push(`updated_at = NOW()`);
  const sql = `UPDATE ignored_conversations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, session_key, owner_account_id, user_id, thread_id, name, created_at, updated_at`;
  values.push(id);

  const res = await db.query(sql, values);
  return res.rows[0] || null;
}

export async function removeById(id) {
  const res = await db.query(`DELETE FROM ignored_conversations WHERE id = $1 RETURNING id`, [id]);
  return res.rowCount > 0;
}

export default {
  list,
  getById,
  getByKey,
  upsert,
  updateById,
  removeById,
};

