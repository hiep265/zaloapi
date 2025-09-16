import { Router } from 'express';
import {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
} from '../controllers/staff.controller.js';

const router = Router();

// CRUD Staff
// GET /api/staff
router.get('/', listStaff);

// GET /api/staff/:id
router.get('/:id', getStaff);

// POST /api/staff
router.post('/', createStaff);

// PATCH /api/staff/:id
router.patch('/:id', updateStaff);

// DELETE /api/staff/:id
router.delete('/:id', deleteStaff);

export default router;
