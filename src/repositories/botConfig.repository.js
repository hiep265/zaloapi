import db from '../db/index.js';

export async function getBySessionKey(session_key) {
  const res = await db.query(
    `SELECT id, session_key, stop_minutes, created_at, updated_at
     FROM bot_configs
     WHERE session_key = $1
     LIMIT 1`,
    [session_key]
  );
  return res.rows[0] || null;
}

export async function upsert({ session_key, stop_minutes = 10 }) {
  const res = await db.query(
    `INSERT INTO bot_configs(session_key, stop_minutes)
     VALUES ($1, $2)
     ON CONFLICT (session_key)
     DO UPDATE SET stop_minutes = EXCLUDED.stop_minutes,
                   updated_at = NOW()
     RETURNING id, session_key, stop_minutes, created_at, updated_at`,
    [session_key, stop_minutes]
  );
  return res.rows[0];
}

export async function setStopMinutes(session_key, stop_minutes) {
  const row = await upsert({ session_key, stop_minutes });
  return row;
}

export async function list({ limit = 50, offset = 0 } = {}) {
  const res = await db.query(
    `SELECT id, session_key, stop_minutes, created_at, updated_at
     FROM bot_configs
     ORDER BY updated_at DESC, created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows;
}

export default {
  getBySessionKey,
  upsert,
  setStopMinutes,
  list,
};
