import db from '../db/index.js';

export async function list({ limit = 50, offset = 0, includeInactive = false } = {}) {
  const res = await db.query(
    `SELECT id, zalo_uid, name, role,
            can_control_bot, can_manage_orders,
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
            can_control_bot, can_manage_orders,
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
            can_control_bot, can_manage_orders,
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
    can_manage_orders = false,
  } = permissions;

  const res = await db.query(
    `INSERT INTO staff(
        zalo_uid, name, role,
        can_control_bot, can_manage_orders,
        associated_session_keys
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, zalo_uid, name, role,
               can_control_bot, can_manage_orders,
               associated_session_keys,
               is_active, created_at, updated_at`,
    [
      zalo_uid,
      name,
      role,
      can_control_bot,
      can_manage_orders,
      associated_session_keys,
    ]
  );
  return res.rows[0];
}

export async function update(id, { name, role, permissions, associated_session_keys, is_active }) {
  // Fetch current to determine effective role
  const current = await getById(id);
  if (!current) return null;

  // Determine target role after update
  const targetRole = (role !== undefined ? role : current.role) || '';
  const isAdminTarget = String(targetRole).toLowerCase() === 'admin';

  // Build dynamic updates
  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
  if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
  if (permissions) {
    if (permissions.can_control_bot !== undefined) { fields.push(`can_control_bot = $${idx++}`); values.push(permissions.can_control_bot); }
    if (permissions.can_manage_orders !== undefined) {
      // Business rule: admins cannot have can_manage_orders revoked
      if (isAdminTarget && permissions.can_manage_orders === false) {
        // ignore this field update
      } else {
        fields.push(`can_manage_orders = $${idx++}`);
        values.push(permissions.can_manage_orders);
      }
    }
  }
  if (associated_session_keys !== undefined) { fields.push(`associated_session_keys = $${idx++}`); values.push(associated_session_keys); }
  if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }

  if (fields.length === 0) {
    return current; // nothing to update
  }

  fields.push(`updated_at = NOW()`);
  const sql = `UPDATE staff SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, zalo_uid, name, role,
    can_control_bot, can_manage_orders,
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
