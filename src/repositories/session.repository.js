import db from '../db/index.js';

export async function getActiveSession() {
  const res = await db.query(
    `SELECT id, account_id, display_name, cookies_json, imei, user_agent, language, is_active, updated_at, session_key, api_key, chatbot_priority
     FROM sessions
     WHERE is_active = true
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return res.rows[0] || null;
}

// Prefer precise update by session id to avoid touching multiple rows for the same session_key
export async function setAccountIdById(session_id, account_id) {
  const res = await db.query(
    `UPDATE sessions SET account_id=$2, updated_at=NOW() WHERE id=$1 RETURNING id`,
    [session_id, account_id]
  );
  return res.rows[0]?.id || null;
}

// Backward-compatible helper: update the most recently updated row for this session_key
// that has account_id IS NULL (or already equals the provided account_id).
export async function setAccountIdBySessionKey(session_key, account_id) {
  const res = await db.query(
    `WITH target AS (
       SELECT id FROM sessions
       WHERE session_key = $1 AND is_active = true AND (account_id IS NULL OR account_id = $2)
       ORDER BY updated_at DESC
       LIMIT 1
     )
     UPDATE sessions SET account_id = $2, updated_at = NOW()
     WHERE id IN (SELECT id FROM target)
     RETURNING id`,
    [session_key, account_id]
  );
  return res.rows[0]?.id || null;
}

export async function listActiveSessions() {
  const res = await db.query(
    `SELECT id, account_id, display_name, cookies_json, imei, user_agent, language, is_active, updated_at, session_key, api_key, chatbot_priority
     FROM sessions
     WHERE is_active = true
     ORDER BY updated_at DESC`
  );
  return res.rows || [];
}

export async function listBySessionKey(session_key, activeOnly = true) {
  const res = await db.query(
    `SELECT id, session_key, account_id, display_name, is_active, updated_at, chatbot_priority
     FROM sessions
     WHERE session_key = $1 ${activeOnly ? 'AND is_active = true' : ''}
     ORDER BY updated_at DESC`,
    [session_key]
  );
  return res.rows || [];
}

export async function upsertActiveSession({ account_id, display_name, cookies_json, imei, user_agent, language, api_key }) {
  // Simple strategy: deactivate others and insert a new active session
  await db.query('UPDATE sessions SET is_active = false WHERE is_active = true');
  const res = await db.query(
    `INSERT INTO sessions(account_id, display_name, cookies_json, imei, user_agent, language, api_key, is_active)
     VALUES($1, $2, $3::jsonb, $4, $5, $6, $7, true)
     RETURNING id`,
    [account_id || null, display_name || null, cookies_json || null, imei || null, user_agent || null, language || null, api_key || null]
  );
  console.log('[DB] upsertActiveSession inserted id:', res.rows[0]?.id);
  return res.rows[0];
}

// Multi-session helpers
export async function getBySessionKey(session_key, account_id = undefined) {
  if (account_id !== undefined && account_id !== null) {
    const res = await db.query(
      `SELECT id, account_id, display_name, cookies_json, imei, user_agent, language, is_active, updated_at, session_key, api_key, chatbot_priority
       FROM sessions
       WHERE session_key = $1 AND account_id = $2 AND is_active = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [session_key, account_id]
    );
    return res.rows[0] || null;
  }
  const res = await db.query(
    `SELECT id, account_id, display_name, cookies_json, imei, user_agent, language, is_active, updated_at, session_key, api_key, chatbot_priority
     FROM sessions
     WHERE session_key = $1 AND is_active = true
     ORDER BY updated_at DESC
     LIMIT 1`,
    [session_key]
  );
  return res.rows[0] || null;
}

export async function upsertBySessionKey({ session_key, account_id, display_name, cookies_json, imei, user_agent, language, api_key }) {
  // Upsert by (session_key, account_id) if account_id is provided.
  // If account_id is null/undefined, upsert the most recent NULL-account record for this session_key.
  if (account_id !== undefined && account_id !== null) {
    const exists = await db.query(
      `SELECT id FROM sessions WHERE session_key = $1 AND account_id = $2 LIMIT 1`,
      [session_key, account_id]
    );
    if (exists.rows[0]) {
      const res = await db.query(
        `UPDATE sessions
         SET cookies_json=$3::jsonb, imei=$4, user_agent=$5, language=$6, api_key=$7, display_name=$8, is_active=true, updated_at=NOW()
         WHERE session_key=$1 AND account_id=$2
         RETURNING id`,
        [session_key, account_id, cookies_json || null, imei || null, user_agent || null, language || null, api_key || null, display_name || null]
      );
      console.log('[DB] upsertBySessionKey updated id:', res.rows[0]?.id);
      return res.rows[0];
    }
    const res = await db.query(
      `INSERT INTO sessions(session_key, account_id, display_name, cookies_json, imei, user_agent, language, api_key, is_active)
       VALUES($1, $2, $3, $4::jsonb, $5, $6, $7, $8, true)
       RETURNING id`,
      [session_key, account_id, display_name || null, cookies_json || null, imei || null, user_agent || null, language || null, api_key || null]
    );
    console.log('[DB] upsertBySessionKey inserted id:', res.rows[0]?.id);
    return res.rows[0];
  }
  // account_id is not provided -> upsert the latest NULL-account record
  const exists = await db.query(
    `SELECT id FROM sessions WHERE session_key = $1 AND account_id IS NULL LIMIT 1`,
    [session_key]
  );
  if (exists.rows[0]) {
    const res = await db.query(
      `UPDATE sessions
       SET cookies_json=$2::jsonb, imei=$3, user_agent=$4, language=$5, api_key=$6, display_name=$7, is_active=true, updated_at=NOW()
       WHERE id=$1
       RETURNING id`,
      [exists.rows[0].id, cookies_json || null, imei || null, user_agent || null, language || null, api_key || null, display_name || null]
    );
    console.log('[DB] upsertBySessionKey updated null-account id:', res.rows[0]?.id);
    return res.rows[0];
  }
  const res = await db.query(
    `INSERT INTO sessions(session_key, account_id, display_name, cookies_json, imei, user_agent, language, api_key, is_active)
     VALUES($1, NULL, $2, $3::jsonb, $4, $5, $6, $7, true)
     RETURNING id`,
    [session_key, display_name || null, cookies_json || null, imei || null, user_agent || null, language || null, api_key || null]
  );
  console.log('[DB] upsertBySessionKey inserted null-account id:', res.rows[0]?.id);
  return res.rows[0];
}

export async function deleteSessionByKey(session_key, account_id = undefined) {
  // Set session as inactive instead of deleting to preserve message data relationships
  if (account_id !== undefined && account_id !== null) {
    const res = await db.query(
      `UPDATE sessions SET is_active = false, updated_at = NOW()
       WHERE session_key = $1 AND account_id = $2 AND is_active = true
       RETURNING id`,
      [session_key, account_id]
    );
    console.log('[DB] deleteSessionByKey deactivated session:', session_key, 'account_id:', account_id, 'id:', res.rows[0]?.id);
    return res.rows[0]?.id || null;
  }
  const res = await db.query(
    `UPDATE sessions SET is_active = false, updated_at = NOW() 
     WHERE session_key = $1 AND is_active = true
     RETURNING id`,
    [session_key]
  );
  console.log('[DB] deleteSessionByKey deactivated session:', session_key, 'id:', res.rows[0]?.id);
  return res.rows[0]?.id || null;
}

export async function deleteSessionById(id) {
  const res = await db.query(
    `UPDATE sessions SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true RETURNING id`,
    [id]
  );
  return res.rows[0]?.id || null;
}

export async function setChatbotPriority(session_key, account_id, priority) {
  const hasAccount = account_id !== undefined && account_id !== null;
  const res = await db.query(
    `UPDATE sessions SET chatbot_priority = $${hasAccount ? 3 : 2}, updated_at = NOW()
     WHERE session_key = $1 ${hasAccount ? 'AND account_id = $2' : ''} AND is_active = true
     RETURNING id, chatbot_priority`,
    hasAccount ? [session_key, account_id, priority] : [session_key, priority]
  );
  console.log('[DB] setChatbotPriority updated session:', session_key, 'account_id:', account_id ?? '(any)', 'priority:', priority, 'id:', res.rows[0]?.id);
  return res.rows[0] || null;
}

export default {
  getActiveSession,
  listActiveSessions,
  listBySessionKey,
  upsertActiveSession,
  getBySessionKey,
  upsertBySessionKey,
  setAccountIdById,
  setAccountIdBySessionKey,
  deleteSessionByKey,
  deleteSessionById,
  setChatbotPriority,
};

