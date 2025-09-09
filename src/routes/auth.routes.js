import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

/**
 * @openapi
 * /api/auth/qr:
 *   get:
 *     summary: Đăng nhập Zalo qua QR (SSE)
 *     description: Trả về Server-Sent Events với các sự kiện QRCodeGenerated, QRCodeExpired, QRCodeScanned, QRCodeDeclined, GotLoginInfo, SessionSaved.
 *     parameters:
 *       - in: query
 *         name: key
 *         required: false
 *         schema:
 *           type: string
 *         description: Session key (nên truyền user_id của hệ thống bạn)
 *       - in: query
 *         name: ua
 *         required: false
 *         schema:
 *           type: string
 *         description: User-Agent dùng cho loginQR
 *     responses:
 *       200:
 *         description: SSE stream
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 data: {"type":"QRCodeGenerated","data":{...}}
 *
 */
// SSE endpoint to start QR login flow
router.get('/qr', authController.loginQR);

/**
 * @openapi
 * /api/auth/qr/image:
 *   get:
 *     summary: Lấy ảnh QR (PNG) để hiển thị trực tiếp
 *     description: Trả về image/png. Có thể truyền ?key={session_key} để lưu phiên theo người dùng.
 *     parameters:
 *       - in: query
 *         name: key
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: ua
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ảnh PNG của QR
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/qr/image', authController.getQrImage);

/**
 * @openapi
 * /api/auth/session/{key}:
 *   get:
 *     summary: Kiểm tra trạng thái phiên theo session_key
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Trạng thái phiên
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 exists:
 *                   type: boolean
 *                 account_id:
 *                   type: string
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Không tìm thấy phiên theo key
 */
// Check session status by session key
router.get('/session/:key', authController.getSessionStatus);

export default router;
