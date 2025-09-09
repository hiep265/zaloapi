import { Router } from 'express';
import * as usersController from '../controllers/users.controller.js';

const router = Router();

/**
 * @openapi
 * /api/users/map:
 *   post:
 *     summary: Ánh xạ external_user_id sang zalo_uid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [external_user_id, zalo_uid]
 *             properties:
 *               external_user_id:
 *                 type: string
 *               zalo_uid:
 *                 type: string
 *     responses:
 *       200:
 *         description: OK
 */
// Map external_user_id to zalo_uid
router.post('/map', usersController.mapExternalToZalo);

/**
 * @openapi
 * /api/users/{external_user_id}:
 *   get:
 *     summary: Lấy profile theo external_user_id
 *     parameters:
 *       - in: path
 *         name: external_user_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: refresh
 *         required: false
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Profile JSON
 *       404:
 *         description: Chưa có mapping external_user_id → zalo_uid
 */
// Get user profile by external_user_id (cached, with optional refresh)
router.get('/:external_user_id', usersController.getUserByExternalId);

export default router;
