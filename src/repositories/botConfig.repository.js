import db from '../db/index.js';

export async function getBySessionKey(session_key, owner_account_id = null) {
  const hasAcc = owner_account_id != null;
  const res = await db.query(
    `SELECT id, session_key, owner_account_id, stop_minutes, created_at, updated_at
     FROM bot_configs
     WHERE session_key = $1 ${hasAcc ? 'AND owner_account_id = $2' : ''}
     LIMIT 1`,
    hasAcc ? [session_key, owner_account_id] : [session_key]
  );
  return res.rows[0] || null;
}

export async function upsert({ session_key, owner_account_id = null, stop_minutes = 10 }) {
  const res = await db.query(
    `INSERT INTO bot_configs(session_key, owner_account_id, stop_minutes)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_key, owner_account_id)
     DO UPDATE SET stop_minutes = EXCLUDED.stop_minutes,
                   updated_at = NOW()
     RETURNING id, session_key, owner_account_id, stop_minutes, created_at, updated_at`,
    [session_key, owner_account_id, stop_minutes]
  );
  return res.rows[0];
}

export async function setStopMinutes(session_key, stop_minutes, owner_account_id = null) {
  const row = await upsert({ session_key, owner_account_id, stop_minutes });
  return row;
}

export async function list({ limit = 50, offset = 0 } = {}) {
  const res = await db.query(
    `SELECT id, session_key, owner_account_id, stop_minutes, created_at, updated_at
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

