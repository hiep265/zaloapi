import { Router } from 'express';
import * as sessionController from '../controllers/session.controller.js';

const router = Router();

// Set or replace active Zalo session
router.post('/', sessionController.setActiveSession);

// Chatbot priority routes
router.put('/:sessionKey/chatbot-priority', sessionController.setChatbotPriority);
router.get('/:sessionKey/chatbot-priority', sessionController.getChatbotPriority);

export default router;
