import * as staffRepo from '../repositories/staff.repository.js';

/**
 * GET /api/staff
 * Query: limit, offset, includeInactive
 */
export async function listStaff(req, res, next) {
  try {
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);
    const includeInactive = String(req.query.includeInactive || 'false') === 'true';
    const rows = await staffRepo.list({ limit, offset, includeInactive });
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
}

/**
 * GET /api/staff/:id
 */
export async function getStaff(req, res, next) {
  try {
    const { id } = req.params;
    const row = await staffRepo.getById(id);
    if (!row) return res.status(404).json({ ok: false, error: 'Staff not found' });
    res.json({ ok: true, data: row });
  } catch (err) { next(err); }
}

/**
 * POST /api/staff
 * Body: { zalo_uid, name, role, permissions?, associated_session_keys? }
 */
export async function createStaff(req, res, next) {
  try {
    const { zalo_uid, name, role, permissions, associated_session_keys } = req.body || {};
    if (!zalo_uid || !name || !role) {
      return res.status(400).json({ ok: false, error: 'zalo_uid, name, role are required' });
    }
    const created = await staffRepo.create({ zalo_uid, name, role, permissions, associated_session_keys });
    res.status(201).json({ ok: true, data: created });
  } catch (err) { next(err); }
}

/**
 * PATCH /api/staff/:id
 */
export async function updateStaff(req, res, next) {
  try {
    const { id } = req.params;
    const { name, role, permissions, associated_session_keys, is_active } = req.body || {};
    const updated = await staffRepo.update(id, { name, role, permissions, associated_session_keys, is_active });
    if (!updated) return res.status(404).json({ ok: false, error: 'Staff not found' });
    res.json({ ok: true, data: updated });
  } catch (err) { next(err); }
}

/**
 * DELETE /api/staff/:id (soft delete)
 */
export async function deleteStaff(req, res, next) {
  try {
    const { id } = req.params;
    const ok = await staffRepo.softDelete(id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Staff not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export default {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
};
