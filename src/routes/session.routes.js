import { Router } from 'express';
import * as sessionController from '../controllers/session.controller.js';

const router = Router();

// Set or replace active Zalo session
router.post('/', sessionController.setActiveSession);

export default router;
