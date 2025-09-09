import db from '../db/index.js';

export async function getByExternalId(externalUserId) {
  const res = await db.query(
    `SELECT id, external_user_id, zalo_uid, profile_json, created_at, updated_at
     FROM users WHERE external_user_id = $1 LIMIT 1`,
    [externalUserId]
  );
  return res.rows[0] || null;
}

export async function upsertMapping({ external_user_id, zalo_uid }) {
  const res = await db.query(
    `INSERT INTO users(external_user_id, zalo_uid)
     VALUES($1, $2)
     ON CONFLICT (external_user_id)
     DO UPDATE SET zalo_uid = EXCLUDED.zalo_uid, updated_at = NOW()
     RETURNING id, external_user_id, zalo_uid, profile_json, created_at, updated_at`,
    [external_user_id, zalo_uid]
  );
  return res.rows[0];
}

export async function updateProfile(externalUserId, profileJson) {
  const res = await db.query(
    `UPDATE users
     SET profile_json = $2, updated_at = NOW()
     WHERE external_user_id = $1
     RETURNING id, external_user_id, zalo_uid, profile_json, created_at, updated_at`,
    [externalUserId, profileJson]
  );
  return res.rows[0] || null;
}

export default {
  getByExternalId,
  upsertMapping,
  updateProfile,
};
