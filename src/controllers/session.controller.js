import * as sessionRepo from '../repositories/session.repository.js';

// POST /api/session
// Body: { cookies_json: object|array, imei: string, user_agent: string, language?: string, account_id?: string }
export async function setActiveSession(req, res, next) {
  try {
    const { cookies_json, imei, user_agent, language, account_id } = req.body || {};
    if (!cookies_json || !imei || !user_agent) {
      return res.status(400).json({ error: 'cookies_json, imei, user_agent are required' });
    }
    const result = await sessionRepo.upsertActiveSession({
      account_id,
      cookies_json,
      imei,
      user_agent,
      language: language || 'vi',
    });
    res.status(200).json({ ok: true, session_id: result.id });
  } catch (err) {
    next(err);
  }
}

// PUT /api/session/:sessionKey/chatbot-priority
// Body: { priority: 'mobile' | 'custom' }
export async function setChatbotPriority(req, res, next) {
  try {
    const { sessionKey } = req.params;
    const { priority, account_id: bodyAccountId } = req.body || {};
    const queryAccountId = typeof req.query?.account_id === 'string' ? req.query.account_id : undefined;
    const account_id = bodyAccountId ?? queryAccountId ?? undefined;

    if (!sessionKey) {
      return res.status(400).json({ error: 'sessionKey is required' });
    }

    // Normalize priority: allow 'null' (string) or null to clear priority
    let normalizedPriority = priority;
    if (typeof normalizedPriority === 'string' && normalizedPriority.toLowerCase() === 'null') {
      normalizedPriority = null;
    }
    if (normalizedPriority !== null && !['mobile', 'custom'].includes(normalizedPriority)) {
      return res.status(400).json({ error: 'priority must be either "mobile", "custom" or null' });
    }

    const result = await sessionRepo.setChatbotPriority(sessionKey, account_id, normalizedPriority);
    
    if (!result) {
      return res.status(404).json({ error: 'Session not found or inactive' });
    }

    res.status(200).json({ 
      ok: true, 
      session_id: result.id, 
      chatbot_priority: result.chatbot_priority 
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/session/:sessionKey/chatbot-priority
export async function getChatbotPriority(req, res, next) {
  try {
    const { sessionKey } = req.params;
    const queryAccountId = typeof req.query?.account_id === 'string' ? req.query.account_id : undefined;

    if (!sessionKey) {
      return res.status(400).json({ error: 'sessionKey is required' });
    }

    const session = await sessionRepo.getBySessionKey(sessionKey, queryAccountId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found or inactive' });
    }

    res.status(200).json({ 
      ok: true, 
      session_id: session.id, 
      chatbot_priority: session.chatbot_priority || 'mobile' 
    });
  } catch (err) {
    next(err);
  }
}

