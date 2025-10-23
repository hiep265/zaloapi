import * as repo from '../repositories/ignoredConversations.repository.js';
import config from '../config/index.js';

/**
 * GET /api/ignored-conversations
 * Query: session_key?, thread_id?, user_id?, limit?, offset?
 */
export async function listIgnored(req, res, next) {
  try {
    const { session_key, account_id, thread_id, user_id } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = await repo.list({ session_key, owner_account_id: account_id || null, thread_id, user_id, limit, offset });
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err) { next(err); }
}

/**
 * GET /api/ignored-conversations/:id
 */
export async function getIgnored(req, res, next) {
  try {
    const { id } = req.params;
    const row = await repo.getById(id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: row });
  } catch (err) { next(err); }
}

/**
 * POST /api/ignored-conversations
 * Body: { session_key, account_id, thread_id, name?, user_id? }
 * Upsert theo (session_key, account_id, thread_id)
 */
export async function upsertIgnored(req, res, next) {
  try {
    const { session_key, account_id, thread_id, name, user_id } = req.body || {};
    if (!session_key || !account_id || !thread_id) {
      return res.status(400).json({ ok: false, error: 'session_key, account_id and thread_id are required' });
    }
    // 1) Call external APIs first; only save to DB if all succeed
    // const { customBaseUrl, mobileBaseUrl } = config.chatbot || {};
    // const requests = [];

    // Helper for logging request/response
    const callAndLog = async (label, url, options) => {
      try {
        console.log(`[ignored sync] ${label} REQUEST`, { url, ...options, body: options?.body });
        const resp = await fetch(url, options);
        const text = await resp.text();
        console.log(`[ignored sync] ${label} RESPONSE`, { status: resp.status, ok: resp.ok, body: text });
        if (!resp.ok) {
          throw new Error(`${label} HTTP ${resp.status}: ${text || 'no body'}`);
        }
        return true;
      } catch (e) {
        console.error(`[ignored sync] ${label} ERROR`, e);
        throw e;
      }
    };

    // // product control-bot
    // if (customBaseUrl && session_key) {
    //   const url = new URL(`/control-bot/${encodeURIComponent(session_key)}?session_id=${encodeURIComponent(thread_id)}`, customBaseUrl).toString();
    //   requests.push(callAndLog('product control-bot', url, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ command: 'stop' }),
    //   }));
    // }

    // // mobile stop
    // if (mobileBaseUrl && session_key) {
    //   const url = new URL(`/stop/${encodeURIComponent(session_key)}/${encodeURIComponent(thread_id)}`, mobileBaseUrl).toString();
    //   requests.push(callAndLog('mobile stop', url, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ thread_name: name || thread_id }),
    //   }));
    // }

    // try {
    //   await Promise.all(requests);
    // } catch (e) {
    //   // Any external failure: do not persist
    //   return res.status(502).json({ ok: false, error: 'External sync failed. Not saved.' });
    // }

    // 2) Persist only if sync above succeeded
    const created = await repo.upsert({ session_key, owner_account_id: account_id, thread_id, name, user_id });
    return res.status(201).json({ ok: true, data: created });
  } catch (err) { next(err); }
}

/**
 * PATCH /api/ignored-conversations/:id
 * Body: { name?, user_id? }
 */
export async function updateIgnored(req, res, next) {
  try {
    const { id } = req.params;
    const { name, user_id } = req.body || {};
    const updated = await repo.updateById(id, { name, user_id });
    if (!updated) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: updated });
  } catch (err) { next(err); }
}

/**
 * DELETE /api/ignored-conversations/:id
 */
export async function deleteIgnored(req, res, next) {
  try {
    const { id } = req.params;
    // Fetch record to know session_key/thread_id for sync
    const row = await repo.getById(id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });

    const session_key = row.session_key;
    const thread_id = row.thread_id;
    const name = row.name || row.thread_id;

    const { customBaseUrl, mobileBaseUrl } = config.chatbot || {};

    // Helper for logging
    const callAndLog = async (label, url, options) => {
      try {
        console.log(`[ignored sync] ${label} REQUEST`, { url, ...options, body: options?.body });
        const resp = await fetch(url, options);
        const text = await resp.text();
        console.log(`[ignored sync] ${label} RESPONSE`, { status: resp.status, ok: resp.ok, body: text });
        if (!resp.ok) throw new Error(`${label} HTTP ${resp.status}: ${text || 'no body'}`);
        return true;
      } catch (e) {
        console.error(`[ignored sync] ${label} ERROR`, e);
        throw e;
      }
    };

    // const requests = [];
    // // Product: resume/start bot for this session
    // if (customBaseUrl && session_key) {
    //   const url = new URL(`/control-bot/${encodeURIComponent(session_key)}`, customBaseUrl).toString() + `?session_id=${encodeURIComponent(session_key)}`;
    //   requests.push(callAndLog('product control-bot (start)', url, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ command: 'start' }),
    //   }));
    // }
    // // Mobile: start bot for specific thread
    // if (mobileBaseUrl && session_key) {
    //   const url = new URL(`/start/${encodeURIComponent(session_key)}/${encodeURIComponent(thread_id)}`, mobileBaseUrl).toString();
    //   requests.push(callAndLog('mobile start', url, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ thread_name: name }),
    //   }));
    // }

    // try {
    //   await Promise.all(requests);
    // } catch (e) {
    //   return res.status(502).json({ ok: false, error: 'External sync failed. Not deleted.' });
    // }

    const ok = await repo.removeById(id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true });
  } catch (err) { next(err); }
}

export default {
  listIgnored,
  getIgnored,
  upsertIgnored,
  updateIgnored,
  deleteIgnored,
};
