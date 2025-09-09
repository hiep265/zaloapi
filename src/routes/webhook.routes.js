import { Router } from 'express';
import * as webhookController from '../controllers/webhook.controller.js';

const router = Router();

// Zalo OA webhook endpoint
router.post('/', webhookController.handleWebhook);

export default router;
