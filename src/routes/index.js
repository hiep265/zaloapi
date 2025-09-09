import { Router } from 'express';
import webhookRouter from './webhook.routes.js';
import sessionRouter from './session.routes.js';
import usersRouter from './users.routes.js';
import authRouter from './auth.routes.js';

const router = Router();

router.use('/webhook', webhookRouter);
router.use('/session', sessionRouter);
router.use('/users', usersRouter);
router.use('/auth', authRouter);

export default router;
