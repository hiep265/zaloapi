import { Router } from 'express';
import { getMessages, getMessagesByUser, getThreads, getConversationMessages } from '../controllers/messages.controller.js';

const router = Router();

/**
 * @swagger
 * /api/messages:
 *   get:
 *     summary: List messages
 *     description: Fetch messages saved by the Zalo listener with optional filters and pagination.
 *     tags:
 *       - Messages
 *     parameters:
 *       - in: query
 *         name: session_key
 *         schema:
 *           type: string
 *         description: Session key (required if account_id is missing)
 *       - in: query
 *         name: account_id
 *         schema:
 *           type: string
 *         description: Account id (required if session_key is missing)
 *       - in: query
 *         name: peer_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: from_uid
 *         schema:
 *           type: string
 *       - in: query
 *         name: to_uid
 *         schema:
 *           type: string
 *       - in: query
 *         name: msg_type
 *         schema:
 *           type: string
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum: [in, out]
 *       - in: query
 *         name: since_ts
 *         schema:
 *           type: integer
 *           format: int64
 *         description: Milliseconds since epoch
 *       - in: query
 *         name: until_ts
 *         schema:
 *           type: integer
 *           format: int64
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: A list of messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                 count:
 *                   type: integer
 *       400:
 *         description: Missing required query param (session_key or account_id)
 */
router.get('/', getMessages);

/**
 * @swagger
 * /api/messages/user/{user_id}:
 *   get:
 *     summary: List messages by user_id (session_key)
 *     description: Return messages for a specific user (session_key) with optional pagination.
 *     tags:
 *       - Messages
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The session_key of the user in your system
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: A list of messages
 *       400:
 *         description: Missing user_id
 */
router.get('/user/:user_id', getMessagesByUser);

/**
 * @swagger
 * /api/messages/threads/{user_id}:
 *   get:
 *     summary: List conversation threads by user_id (session_key)
 *     description: Group messages by peer_id and return the latest message per thread for a user.
 *     tags:
 *       - Messages
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: A list of threads (latest message per peer_id)
 */
router.get('/threads/:user_id', getThreads);

/**
 * @swagger
 * /api/messages/conversation/{session_key}:
 *   get:
 *     summary: Get messages from a specific conversation
 *     description: Fetch all messages from a conversation thread for messaging app display
 *     tags:
 *       - Messages
 *     parameters:
 *       - in: path
 *         name: session_key
 *         required: true
 *         schema:
 *           type: string
 *         description: Session key of the user
 *       - in: query
 *         name: thread_id
 *         schema:
 *           type: string
 *         description: Thread ID (preferred for new Zalo format)
 *       - in: query
 *         name: peer_id
 *         schema:
 *           type: string
 *         description: Peer ID (legacy support)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *         description: Number of messages to return
 *       - in: query
 *         name: before_ts
 *         schema:
 *           type: integer
 *           format: int64
 *         description: Load messages before this timestamp (for pagination)
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Message ordering (asc for chat display, desc for latest first)
 *     responses:
 *       200:
 *         description: Conversation messages with rich Zalo data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       thread_id:
 *                         type: string
 *                       uid_from:
 *                         type: string
 *                       d_name:
 *                         type: string
 *                       content:
 *                         type: string
 *                       ts:
 *                         type: integer
 *                       is_self:
 *                         type: boolean
 *                       quote:
 *                         type: object
 *                       mentions:
 *                         type: array
 *                       attachments_json:
 *                         type: object
 *                 count:
 *                   type: integer
 *                 conversation_id:
 *                   type: string
 *       400:
 *         description: Missing required parameters
 */
router.get('/conversation/:session_key', getConversationMessages);

export default router;
