import db from '../db/index.js';

export async function list({ limit = 50, offset = 0, includeInactive = false } = {}) {
  const res = await db.query(
    `SELECT id, zalo_uid, name, role,
            can_control_bot, can_view_all_conversations, can_manage_staff,
            associated_session_keys,
            is_active, created_at, updated_at
     FROM staff
     WHERE ($1::boolean = true OR is_active = true)
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [includeInactive, limit, offset]
  );
  return res.rows;
}

export async function getById(id) {
  const res = await db.query(
    `SELECT id, zalo_uid, name, role,
            can_control_bot, can_view_all_conversations, can_manage_staff,
            associated_session_keys,
            is_active, created_at, updated_at
     FROM staff
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return res.rows[0] || null;
}

export async function getByZaloUid(zaloUid) {
  const res = await db.query(
    `SELECT id, zalo_uid, name, role,
            can_control_bot, can_view_all_conversations, can_manage_staff,
            associated_session_keys,
            is_active, created_at, updated_at
     FROM staff
     WHERE zalo_uid = $1
     LIMIT 1`,
    [zaloUid]
  );
  return res.rows[0] || null;
}

export async function create({ zalo_uid, name, role, permissions = {}, associated_session_keys = [] }) {
  const {
    can_control_bot = false,
    can_view_all_conversations = false,
    can_manage_staff = false,
  } = permissions;

  const res = await db.query(
    `INSERT INTO staff(
        zalo_uid, name, role,
        can_control_bot, can_view_all_conversations, can_manage_staff,
        associated_session_keys
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, zalo_uid, name, role,
               can_control_bot, can_view_all_conversations, can_manage_staff,
               associated_session_keys,
               is_active, created_at, updated_at`,
    [
      zalo_uid,
      name,
      role,
      can_control_bot,
      can_view_all_conversations,
      can_manage_staff,
      associated_session_keys,
    ]
  );
  return res.rows[0];
}

export async function update(id, { name, role, permissions, associated_session_keys, is_active }) {
  // Build dynamic updates
  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
  if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
  if (permissions) {
    if (permissions.can_control_bot !== undefined) { fields.push(`can_control_bot = $${idx++}`); values.push(permissions.can_control_bot); }
    if (permissions.can_view_all_conversations !== undefined) { fields.push(`can_view_all_conversations = $${idx++}`); values.push(permissions.can_view_all_conversations); }
    if (permissions.can_manage_staff !== undefined) { fields.push(`can_manage_staff = $${idx++}`); values.push(permissions.can_manage_staff); }
  }
  if (associated_session_keys !== undefined) { fields.push(`associated_session_keys = $${idx++}`); values.push(associated_session_keys); }
  if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }

  if (fields.length === 0) {
    const current = await getById(id);
    return current; // nothing to update
  }

  fields.push(`updated_at = NOW()`);
  const sql = `UPDATE staff SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, zalo_uid, name, role,
    can_control_bot, can_view_all_conversations, can_manage_staff,
    associated_session_keys, is_active, created_at, updated_at`;
  values.push(id);

  const res = await db.query(sql, values);
  return res.rows[0] || null;
}

export async function softDelete(id) {
  const res = await db.query(
    `DELETE FROM staff WHERE id = $1 RETURNING id`,
    [id]
  );
  return res.rowCount > 0;
}

export default {
  list,
  getById,
  getByZaloUid,
  create,
  update,
  softDelete,
};
