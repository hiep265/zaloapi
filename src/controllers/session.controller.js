import * as sessionRepo from '../repositories/session.repository.js';

// POST /api/session
// Body: { cookies_json: object|array, imei: string, user_agent: string, language?: string, account_id?: string }
export async function setActiveSession(req, res, next) {
  try {
    const { cookies_json, imei, user_agent, language, account_id } = req.body || {};
    if (!cookies_json || !imei || !user_agent) {
      return res.status(400).json({ error: 'cookies_json, imei, user_agent are required' });
    }
    const result = await sessionRepo.upsertActiveSession({
      account_id,
      cookies_json,
      imei,
      user_agent,
      language: language || 'vi',
    });
    res.status(200).json({ ok: true, session_id: result.id });
  } catch (err) {
    next(err);
  }
}
