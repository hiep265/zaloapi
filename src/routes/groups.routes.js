import { Router } from 'express';
import * as controller from '../controllers/groups.controller.js';

const router = Router();

// Create a group with all staff who have can_manage_orders=true (excluding self)
router.post('/managers', controller.createManagersGroup);

export default router;
