import { Router } from 'express';
import {
  listIgnored,
  getIgnored,
  upsertIgnored,
  updateIgnored,
  deleteIgnored,
} from '../controllers/ignoredConversations.controller.js';

const router = Router();

// GET /api/ignored-conversations
router.get('/', listIgnored);

// GET /api/ignored-conversations/:id
router.get('/:id', getIgnored);

// POST /api/ignored-conversations
// Upsert theo (session_key, thread_id)
router.post('/', upsertIgnored);

// PATCH /api/ignored-conversations/:id
router.patch('/:id', updateIgnored);

// DELETE /api/ignored-conversations/:id
router.delete('/:id', deleteIgnored);

export default router;
