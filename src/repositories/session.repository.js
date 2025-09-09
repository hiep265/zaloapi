import db from '../db/index.js';

export async function getActiveSession() {
  const res = await db.query(
    `SELECT id, account_id, cookies_json, imei, user_agent, language, is_active, updated_at, session_key
     FROM sessions
     WHERE is_active = true
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return res.rows[0] || null;
}

export async function listActiveSessions() {
  const res = await db.query(
    `SELECT id, account_id, cookies_json, imei, user_agent, language, is_active, updated_at, session_key
     FROM sessions
     WHERE is_active = true
     ORDER BY updated_at DESC`
  );
  return res.rows || [];
}

export async function upsertActiveSession({ account_id, cookies_json, imei, user_agent, language }) {
  // Simple strategy: deactivate others and insert a new active session
  await db.query('UPDATE sessions SET is_active = false WHERE is_active = true');
  const res = await db.query(
    `INSERT INTO sessions(account_id, cookies_json, imei, user_agent, language, is_active)
     VALUES($1, $2::jsonb, $3, $4, $5, true)
     RETURNING id`,
    [account_id || null, cookies_json || null, imei || null, user_agent || null, language || null]
  );
  console.log('[DB] upsertActiveSession inserted id:', res.rows[0]?.id);
  return res.rows[0];
}

// Multi-session helpers
export async function getBySessionKey(session_key) {
  const res = await db.query(
    `SELECT id, account_id, cookies_json, imei, user_agent, language, is_active, updated_at, session_key
     FROM sessions
     WHERE session_key = $1 AND is_active = true
     ORDER BY updated_at DESC
     LIMIT 1`,
    [session_key]
  );
  return res.rows[0] || null;
}

export async function upsertBySessionKey({ session_key, account_id, cookies_json, imei, user_agent, language }) {
  // Upsert by session_key; do NOT deactivate other sessions
  const exists = await db.query(
    `SELECT id FROM sessions WHERE session_key = $1 LIMIT 1`,
    [session_key]
  );
  if (exists.rows[0]) {
    const res = await db.query(
      `UPDATE sessions SET account_id=$2, cookies_json=$3::jsonb, imei=$4, user_agent=$5, language=$6, is_active=true, updated_at=NOW()
       WHERE session_key=$1
       RETURNING id`,
      [session_key, account_id || null, cookies_json || null, imei || null, user_agent || null, language || null]
    );
    console.log('[DB] upsertBySessionKey updated id:', res.rows[0]?.id);
    return res.rows[0];
  }
  const res = await db.query(
    `INSERT INTO sessions(session_key, account_id, cookies_json, imei, user_agent, language, is_active)
     VALUES($1, $2, $3::jsonb, $4, $5, $6, true)
     RETURNING id`,
    [session_key, account_id || null, cookies_json || null, imei || null, user_agent || null, language || null]
  );
  console.log('[DB] upsertBySessionKey inserted id:', res.rows[0]?.id);
  return res.rows[0];
}

export default {
  getActiveSession,
  listActiveSessions,
  upsertActiveSession,
  getBySessionKey,
  upsertBySessionKey,
};
