import { getBySessionKey, setStopMinutes, list as listConfigs } from '../repositories/botConfig.repository.js';

/**
 * @swagger
 * /api/bot-configs:
 *   get:
 *     summary: List bot configs
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 */
export async function list(req, res, next) {
  try {
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);
    const rows = await listConfigs({ limit, offset });
    res.json({ data: rows });
  } catch (e) { next(e); }
}

/**
 * @swagger
 * /api/bot-configs/{session_key}:
 *   get:
 *     summary: Get bot config for a session_key
 *     parameters:
 *       - in: path
 *         name: session_key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: OK
 */
export async function get(req, res, next) {
  try {
    const { session_key } = req.params;
    const account_id = req.query?.account_id ? String(req.query.account_id) : null;
    const row = await getBySessionKey(session_key, account_id || null);
    res.json({ data: row });
  } catch (e) { next(e); }
}

/**
 * @swagger
 * /api/bot-configs/{session_key}:
 *   put:
 *     summary: Upsert bot config (stop_minutes) for a session_key
 *     parameters:
 *       - in: path
 *         name: session_key
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stop_minutes:
 *                 type: integer
 *     responses:
 *       200:
 *         description: OK
 */
export async function upsert(req, res, next) {
  try {
    const { session_key } = req.params;
    const { stop_minutes, account_id } = req.body || {};
    const minutes = Number.isFinite(Number(stop_minutes)) ? Number(stop_minutes) : 10;
    const row = await setStopMinutes(session_key, minutes, account_id || null);
    res.json({ data: row });
  } catch (e) { next(e); }
}

export default { list, get, upsert };
