import { Router } from 'express';
import * as controller from '../controllers/botConfig.controller.js';

const router = Router();

router.get('/', controller.list);
router.get('/:session_key', controller.get);
router.put('/:session_key', controller.upsert);

export default router;
