import { Router } from 'express';
import webhookRouter from './webhook.routes.js';
import sessionRouter from './session.routes.js';
import usersRouter from './users.routes.js';
import authRouter from './auth.routes.js';
import messagesRouter from './messages.routes.js';
import staffRouter from './staff.routes.js';

const router = Router();

router.use('/webhook', webhookRouter);
router.use('/session', sessionRouter);
router.use('/users', usersRouter);
router.use('/auth', authRouter);
router.use('/messages', messagesRouter);
router.use('/staff', staffRouter);

export default router;
