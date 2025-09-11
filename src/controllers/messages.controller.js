import { queryMessages, getThreadsByUser, getConversation } from '../repositories/message.repository.js';

export async function getMessages(req, res, next) {
  try {
    const {
      session_key,
      account_id,
      thread_id,
      uid_from,
      peer_id,
      from_uid,
      to_uid,
      msg_type,
      direction,
      since_ts,
      until_ts,
      limit,
      offset,
      order,
    } = req.query;

    if (!session_key && !account_id) {
      return res.status(400).json({ error: 'Missing session_key or account_id' });
    }

    const options = {
      session_key: session_key || null,
      account_id: account_id || null,
      thread_id: thread_id || null,
      uid_from: uid_from || null,
      peer_id: peer_id || null,
      from_uid: from_uid || null,
      to_uid: to_uid || null,
      msg_type: msg_type || null,
      direction: direction || null,
      since_ts: since_ts ? Number(since_ts) : null,
      until_ts: until_ts ? Number(until_ts) : null,
      limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
      offset: Math.max(Number(offset) || 0, 0),
      order: order === 'asc' ? 'asc' : 'desc',
    };

    const rows = await queryMessages(options);
    res.json({ items: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function getThreads(req, res, next) {
  try {
    const { user_id } = req.params;
    const { limit, offset } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }
    const rows = await getThreadsByUser(user_id, {
      limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
      offset: Math.max(Number(offset) || 0, 0),
    });
    res.json({ items: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
}

// New endpoint for getting conversation messages
export async function getConversationMessages(req, res, next) {
  try {
    const { session_key } = req.params;
    const { thread_id, peer_id, limit, before_ts, order } = req.query;

    if (!session_key) {
      return res.status(400).json({ error: 'Missing session_key' });
    }

    if (!thread_id && !peer_id) {
      return res.status(400).json({ error: 'Missing thread_id or peer_id' });
    }

    const options = {
      session_key,
      thread_id: thread_id || null,
      peer_id: peer_id || null,
      limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
      before_ts: before_ts ? Number(before_ts) : null,
      order: order === 'desc' ? 'desc' : 'asc',
    };

    const messages = await getConversation(options);
    res.json({ 
      items: messages, 
      count: messages.length,
      conversation_id: thread_id || peer_id
    });
  } catch (err) {
    next(err);
  }
}

export default { getMessages, getThreads, getMessagesByUser, getConversationMessages };

export async function getMessagesByUser(req, res, next) {
  try {
    const { user_id } = req.params;
    const { limit, offset, order } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }

    const rows = await queryMessages({
      session_key: user_id,
      limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
      offset: Math.max(Number(offset) || 0, 0),
      order: order === 'asc' ? 'asc' : 'desc',
    });
    res.json({ items: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
}
