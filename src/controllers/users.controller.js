import * as userRepo from '../repositories/user.repository.js';
import zaloService from '../services/zalo.service.js';

// POST /api/users/map
// Body: { external_user_id: string, zalo_uid: string }
export async function mapExternalToZalo(req, res, next) {
  try {
    const { external_user_id, zalo_uid } = req.body || {};
    if (!external_user_id || !zalo_uid) {
      return res.status(400).json({ error: 'external_user_id và zalo_uid là bắt buộc' });
    }
    const row = await userRepo.upsertMapping({ external_user_id, zalo_uid });
    res.status(200).json({ ok: true, data: row });
  } catch (err) {
    next(err);
  }
}

// GET /api/users/:external_user_id
// Trả về profile từ cache DB, nếu không có sẽ gọi zca-js getUserInfo theo zalo_uid và lưu cache
export async function getUserByExternalId(req, res, next) {
  try {
    const { external_user_id } = req.params;
    const existing = await userRepo.getByExternalId(external_user_id);
    if (!existing || !existing.zalo_uid) {
      return res.status(404).json({ error: 'Chưa có mapping external_user_id → zalo_uid' });
    }

    // Nếu đã có profile cache thì trả luôn, có thể thêm query ?refresh=true để làm mới
    const refresh = String(req.query.refresh || 'false') === 'true';
    if (existing.profile_json && !refresh) {
      return res.status(200).json({ ok: true, data: existing.profile_json });
    }

    // Gọi zca-js lấy thông tin người dùng theo zalo_uid
    const resp = await zaloService.getUserInfo(existing.zalo_uid);
    // Theo d.ts, resp.changed_profiles[uid] chứa profile
    const profile = resp?.changed_profiles?.[existing.zalo_uid] || resp;

    // Lưu cache
    const updated = await userRepo.updateProfile(external_user_id, profile);
    res.status(200).json({ ok: true, data: updated?.profile_json || profile });
  } catch (err) {
    next(err);
  }
}
