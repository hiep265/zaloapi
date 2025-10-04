import { Router } from 'express';
import * as controller from '../controllers/groups.controller.js';

const router = Router();

// Create a group with all staff who have can_manage_orders=true (excluding self)
router.post('/managers', controller.createManagersGroup);

// Send a message to a thread if the session owner has can_receive_notifications
router.post('/send-message', controller.sendMessageIfPermitted);

export default router;
