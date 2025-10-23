import { createRequire } from 'module';
import { startAllListeners, stopListener, startListenerForSession } from '../services/listenerManager.js';
import * as sessionRepo from '../repositories/session.repository.js';
import * as staffRepo from '../repositories/staff.repository.js';

const require = createRequire(import.meta.url);

// GET /api/auth/qr -> Server-Sent Events stream
// Client receives events: { type, data }
// On GotLoginInfo, backend will persist session and end the stream
export async function loginQR(req, res, next) {
  try {
    // Prepare SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Allow proxies to keep connection
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const { Zalo, LoginQRCallbackEventType } = require('zca-js');
    const zalo = new Zalo();

    const userAgent = req.query.ua ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
    const sessionKey = String(req.query.key || '').trim() || null;
    const qrPath = undefined; // you can accept req.query.qrPath if you want to save file
    const apiKeyFromHeader = (req.get('X-API-Key') || req.get('x-api-key') || req.headers['x-api-key'] || '').toString() || null;

    const sendEvent = (payload) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (e) {
        // Ignore write errors; connection may be closed
      }
    };

    // Heartbeat to keep connection alive through proxies/load balancers
    const heartbeat = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch (_) {}
    }, 15000);

    // Helper: ensure staff with full permissions
    const ensureStaffWithFullPermissions = async (zaloUid, displayName, sessionKeyForAssoc) => {
      try {
        if (!zaloUid) return;
        const existing = await staffRepo.getByZaloUid(String(zaloUid));
        if (existing) {
          // Chỉ sử dụng sessionKey mới thay vì merge
          const sessionKeys = sessionKeyForAssoc ? [sessionKeyForAssoc] : [];
          await staffRepo.update(existing.id, {
            // keep role if already set; default to 'admin'
            role: existing.role || 'admin',
            name: displayName || existing.name || String(zaloUid),
            permissions: { can_control_bot: true, can_manage_orders: true, can_receive_notifications: true },
            associated_session_keys: sessionKeys,
            is_active: true,
          });
          return existing.id;
        }
        const created = await staffRepo.create({
          zalo_uid: String(zaloUid),
          name: displayName || String(zaloUid),
          role: 'admin',
          permissions: { can_control_bot: true, can_manage_orders: true, can_receive_notifications: true },
          associated_session_keys: sessionKeyForAssoc ? [sessionKeyForAssoc] : [],
        });
        return created?.id;
      } catch (e) {
        console.warn('ensureStaffWithFullPermissions failed:', e?.message || String(e));
      }
    };

    // Start login QR with callback streaming events
    let displayNameHint = null;
    const loginPromise = zalo.loginQR({ userAgent, qrPath }, (event) => {
      try {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated:
            sendEvent({ type: 'QRCodeGenerated', data: event.data });
            break;
          case LoginQRCallbackEventType.QRCodeExpired:
            sendEvent({ type: 'QRCodeExpired' });
            clearInterval(heartbeat);
            try { res.end(); } catch (_) {}
            break;
          case LoginQRCallbackEventType.QRCodeScanned:
            // Capture display name from scan event if available
            try {
              const dn = event?.data?.display_name || event?.data?.displayName || null;
              if (dn) displayNameHint = dn;
            } catch (_) {}
            // Debug: log raw scan event data
            // try { console.log('[DEBUG] QRCodeScanned event.data =', event?.data); } catch (_) {}
            sendEvent({ type: 'QRCodeScanned', data: event.data });
            break;
          case LoginQRCallbackEventType.QRCodeDeclined:
            sendEvent({ type: 'QRCodeDeclined', data: event.data });
            clearInterval(heartbeat);
            try { res.end(); } catch (_) {}
            break;
          case LoginQRCallbackEventType.GotLoginInfo:
            sendEvent({ type: 'GotLoginInfo', data: event.data });
            // Persist active session with account_id (uid). We login immediately to fetch own uid.
            (async () => {
              try {
                const cookies = event.data?.cookie;
                const imei = event.data?.imei;
                const ua = event.data?.userAgent || userAgent;
                
                // Validate required data before proceeding
                if (!cookies) {
                  // No cookies -> cannot persist, but avoid crashing the stream
                  console.error('Missing cookie data from login info');
                }

                // Try to obtain uid, but do not fail if it errors
                let uid = null;
                try {
                  // 1) Prefer UID from event data if provided
                  uid = event?.data?.uid || null;
                  let displayName = null;
                  if (!uid) {
                    // 2) First attempt: loginCookie (closer to your old code and avoids domain mismatch issues)
                    let api = null;
                    try {
                      api = await new Zalo().loginCookie({ cookie: cookies, imei, userAgent: ua, language: 'vi' });
                    } catch (e1) {
                      console.warn('loginCookie failed, fallback to login:', e1?.message || String(e1));
                      // Fallback: normalize to array of {key,value} and use login
                      const cookieForLogin = (() => {
                        if (Array.isArray(cookies)) return cookies;
                        const raw = (typeof cookies === 'string') ? cookies : (cookies?.cookie || cookies?.cookies || '');
                        if (typeof raw === 'string' && raw.trim()) {
                          const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
                          const arr = parts.map(p => {
                            const eq = p.indexOf('=');
                            return eq > 0 ? { key: p.slice(0, eq), value: p.slice(eq + 1) } : null;
                          }).filter(Boolean);
                          return arr.length ? arr : [];
                        }
                        return [];
                      })();
                      try {
                        api = await new Zalo().login({ cookie: cookieForLogin, imei, userAgent: ua, language: 'vi' });
                      } catch (e2) {
                        console.warn('login fallback failed:', e2?.message || String(e2));
                      }
                    }
                    if (api) {
                      // DEBUG: dump context from SDK
                      try {
                        const ctxDbg = typeof api.getContext === 'function' ? api.getContext() : null;
                        console.log('[DEBUG] ctx.uid =', ctxDbg?.uid);
                        // console.log('[DEBUG] ctx.loginInfo keys =', Object.keys(ctxDbg?.loginInfo || {}));
                        // console.log('[DEBUG] ctx.loginInfo =', ctxDbg?.loginInfo);
                      } catch (e) { console.warn('[DEBUG] dump ctx error:', e?.message || String(e)); }
                      // Prefer ID from context if available
                      try {
                        const ctx = typeof api.getContext === 'function' ? api.getContext() : null;
                        uid = ctx?.uid || ctx?.loginInfo?.uid || uid;
                      } catch (_) {}
                      if (!uid && api && typeof api.getOwnId === 'function') {
                        uid = await api.getOwnId();
                      }
                      // Try to fetch display name
                      try {
                        if (uid && typeof api.getUserInfo === 'function') {
                          const info = await api.getUserInfo(uid);
                          // try { console.log('[DEBUG] getUserInfo raw =', JSON.stringify(info, null, 2)); } catch (_) {}
                          // Resolve displayName from nested structures (e.g., changed_profiles)
                          try {
                            const profiles = info?.changed_profiles || info?.profiles || info?.friendProfiles || null;
                            const keyCandidates = [String(uid), `${uid}_0`];
                            let prof = null;
                            if (profiles && typeof profiles === 'object') {
                              for (const k of keyCandidates) {
                                if (profiles[k]) { prof = profiles[k]; break; }
                              }
                            }
                            displayName =
                              prof?.displayName || prof?.zaloName || prof?.username ||
                              info?.name || info?.displayName || info?.userName || info?.user?.name || null;
                          } catch (_) {
                            displayName = info?.name || info?.displayName || info?.userName || info?.user?.name || null;
                          }
                          console.log('[DEBUG] displayName resolved =', displayName);
                          if (displayName) { displayNameHint = displayName; }
                        }
                      } catch (_) {}
                    } else {
                      console.warn('Zalo API instance invalid or missing getOwnId');
                    }
                  }
                  // 3) Fallback: try to read from session (listener may populate soon after)
                  if (!uid && sessionKey) {
                    try {
                      for (let i = 0; i < 3 && !uid; i++) {
                        const s = await sessionRepo.getBySessionKey(sessionKey);
                        uid = s?.account_id || uid;
                        if (!uid) await new Promise(r => setTimeout(r, 500));
                      }
                    } catch (_) {}
                  }
                  if (uid) {
                    console.log('Successfully got user ID:', uid);
                  } else {
                    console.warn('Could not resolve user ID from QR login flow');
                  }
                } catch (loginErr) {
                  console.error('Zalo login/getOwnId error:', loginErr?.message || String(loginErr));
                }
                // Chuẩn hoá cookies_json thành JSON hợp lệ cho cột JSONB
                const cookiesJsonPayload = (() => {
                  if (Array.isArray(cookies)) return cookies; // preserve array for zca-js
                  if (typeof cookies === 'string') return { cookie: cookies };
                  return (cookies || {});
                })();
                const cookiesJsonText = JSON.stringify(cookiesJsonPayload);

                // Save session data
                try {
                  if (sessionKey) {
                    await sessionRepo.upsertBySessionKey({
                      session_key: sessionKey,
                      account_id: uid || null,
                      display_name: displayNameHint || null,
                      cookies_json: cookiesJsonText,
                      imei: imei || null,
                      user_agent: ua,
                      language: 'vi',
                      api_key: apiKeyFromHeader,
                    });
                    console.log('Session saved with key:', sessionKey);
                  } else {
                    await sessionRepo.upsertActiveSession({
                      account_id: uid || null,
                      display_name: displayNameHint || null,
                      cookies_json: cookiesJsonText,
                      imei: imei || null,
                      user_agent: ua,
                      language: 'vi',
                      api_key: apiKeyFromHeader,
                    });
                    console.log('Active session saved');
                  }
                  
                  // Prefer to restart the specific listener with fresh cookies
                  try {
                    if (sessionKey) {
                      const srow = await sessionRepo.getBySessionKey(sessionKey);
                      if (srow) {
                        try { await stopListener(String(srow.session_key)); } catch (_) {}
                        if (srow.account_id) { try { await stopListener(String(srow.account_id)); } catch (_) {} }
                        
                        // Wait a moment for stops to complete, then start
                        setTimeout(async () => {
                          try {
                            await startListenerForSession(srow);
                            console.log('[Listener] restarted listener for session', sessionKey);
                          } catch (err) {
                            console.warn('[Listener] restart failed', err?.message || String(err));
                          }
                        }, 1000);
                      }
                    } else {
                      await startAllListeners();
                      console.log('[Listener] startAllListeners requested');
                    }
                  } catch (e) {
                    console.warn('[Listener] restart after login failed', e?.message || String(e));
                  }

                  // If uid not resolved yet, try polling session to get populated account_id (listener may set it)
                  if (!uid && sessionKey) {
                    try {
                      for (let i = 0; i < 20 && !uid; i++) { // up to ~10 seconds
                        const s = await sessionRepo.getBySessionKey(sessionKey);
                        uid = s?.account_id || uid;
                        if (!uid) await new Promise(r => setTimeout(r, 500));
                      }
                      if (uid) console.log('UID resolved from session after listener start:', uid);
                    } catch (_) {}
                  }

                  // Ensure staff auto-added with full permissions (after best-effort UID resolution)
                  await ensureStaffWithFullPermissions(uid,  displayNameHint, sessionKey || null);
                  sendEvent({ type: 'SessionSaved', ok: true, uid, session_key: sessionKey });
                } catch (dbError) {
                  console.error('Database save error:', dbError.message);
                  // Still send success if we have the login data, even if DB save fails
                  sendEvent({ type: 'SessionSaved', ok: true, uid, session_key: sessionKey, warning: 'DB save failed but login successful' });
                }
              } catch (saveErr) {
                sendEvent({ type: 'SessionSaveError', error: saveErr?.message || String(saveErr) });
              } finally {
                clearInterval(heartbeat);
                try { res.end(); } catch (_) {}
              }
            })();
            break;
          default:
            sendEvent({ type: 'Unknown', raw: event });
            break;
        }
      } catch (cbErr) {
        sendEvent({ type: 'Error', error: cbErr?.message || String(cbErr) });
      }
    }).catch((err) => {
      sendEvent({ type: 'LoginError', error: err?.message || String(err) });
      clearInterval(heartbeat);
      try { res.end(); } catch (_) {}
    });

    // If client disconnects, try to end gracefully
    req.on('close', () => {
      clearInterval(heartbeat);
      try { res.end(); } catch (e) {}
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/qr/image -> Trả về ảnh PNG của QR (không dùng SSE)
export async function getQrImage(req, res, next) {
  try {
    const { Zalo, LoginQRCallbackEventType } = require('zca-js');
    const zalo = new Zalo();

    const userAgent = req.query.ua ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
    const sessionKey = String(req.query.key || '').trim() || null;
    const apiKeyFromHeader = (req.get('X-API-Key') || req.get('x-api-key') || req.headers['x-api-key'] || '').toString() || null;

    let responded = false;
    const sendPng = (base64) => {
      if (responded) return;
      responded = true;
      const img = Buffer.from(base64, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', img.length);
      res.status(200).end(img);
    };

    await zalo.loginQR({ userAgent }, (event) => {
      try {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated:
            // Trả ảnh lần đầu sinh QR
            if (event?.data?.image) sendPng(event.data.image);
            break;
          case LoginQRCallbackEventType.GotLoginInfo:
            // Lưu phiên nền
            (async () => {
              try {
                const cookies = event.data?.cookie;
                const imei = event.data?.imei;
                const ua = event.data?.userAgent || userAgent;
                // Prefer UID from event if present, fallback to login
                let uid = event?.data?.uid || null;
                let displayName = null;
                if (!uid) {
                  const cookieString = Array.isArray(cookies)
                    ? cookies.join('; ')
                    : (typeof cookies === 'string' ? cookies : (cookies?.cookie || ''));
                  const api = await new Zalo().login({ cookie: cookieString, imei, userAgent: ua, language: 'vi' });
                  // Prefer ID from context if available
                  try {
                    const ctx = typeof api.getContext === 'function' ? api.getContext() : null;
                    uid = ctx?.uid || ctx?.loginInfo?.uid || uid;
                  } catch (_) {}
                  if (!uid && typeof api.getOwnId === 'function') {
                    uid = await api.getOwnId();
                  }
                  try {
                    if (uid && typeof api.getUserInfo === 'function') {
                      const info = await api.getUserInfo(uid);
                      displayName = info?.name || info?.displayName || info?.userName || info?.user?.name || null;
                    }
                  } catch (_) {}
                }
                if (!uid && sessionKey) {
                  try {
                    for (let i = 0; i < 3 && !uid; i++) {
                      const s = await sessionRepo.getBySessionKey(sessionKey);
                      uid = s?.account_id || uid;
                      if (!uid) await new Promise(r => setTimeout(r, 500));
                    }
                  } catch (_) {}
                }
                if (sessionKey) {
                  await sessionRepo.upsertBySessionKey({
                    session_key: sessionKey,
                    account_id: uid || null,
                    display_name: displayName || null,
                    cookies_json: cookies || null,
                    imei: imei || null,
                    user_agent: ua,
                    language: 'vi',
                    api_key: apiKeyFromHeader,
                  });
                } else {
                  await sessionRepo.upsertActiveSession({
                    account_id: uid || null,
                    display_name: displayName || null,
                    cookies_json: cookies || null,
                    imei: imei || null,
                    user_agent: ua,
                    language: 'vi',
                    api_key: apiKeyFromHeader,
                  });
                }
                // Prefer to restart the specific listener with fresh cookies (image flow)
                try {
                  if (sessionKey) {
                    const srow = await sessionRepo.getBySessionKey(sessionKey);
                    if (srow) {
                      try { await stopListener(String(srow.session_key)); } catch (_) {}
                      if (srow.account_id) { try { await stopListener(String(srow.account_id)); } catch (_) {} }
                      await startListenerForSession(srow);
                      console.log('[Listener] restarted listener for session (image flow)', sessionKey);
                    }
                  } else {
                    await startAllListeners();
                    console.log('[Listener] startAllListeners requested (image flow)');
                  }
                } catch (e) {
                  console.warn('[Listener] restart after login failed (image flow)', e?.message || String(e));
                }
                // If uid still missing in image flow, poll session briefly
                if (!uid && sessionKey) {
                  try {
                    for (let i = 0; i < 20 && !uid; i++) {
                      const s = await sessionRepo.getBySessionKey(sessionKey);
                      uid = s?.account_id || uid;
                      if (!uid) await new Promise(r => setTimeout(r, 500));
                    }
                    if (uid) console.log('UID resolved from session (image flow):', uid);
                  } catch (_) {}
                }

                // Ensure staff auto-added with full permissions
                if (uid) {
                  try { await staffRepo.create({ zalo_uid: String(uid), name: displayName || String(uid), role: 'admin', permissions: { can_control_bot: true, can_manage_orders: true, can_receive_notifications: true }, associated_session_keys: sessionKey ? [sessionKey] : [] }); } catch (e) {
                    // If already exists, upgrade permissions and set session key
                    try {
                      const existing = await staffRepo.getByZaloUid(String(uid));
                      if (existing) {
                        // Chỉ sử dụng sessionKey mới thay vì merge
                        const sessionKeys = sessionKey ? [sessionKey] : [];
                        await staffRepo.update(existing.id, {
                          role: existing.role || 'admin',
                          permissions: { can_control_bot: true, can_manage_orders: true, can_receive_notifications: true },
                          name: displayName || existing.name || String(uid),
                          associated_session_keys: sessionKeys,
                          is_active: true,
                        });
                      }
                    } catch (_) {}
                  }
                }
              } catch (e) {
                // ignore background save errors here
              }
            })();
            break;
          default:
            break;
        }
      } catch (cbErr) {
        if (!responded) next(cbErr);
      }
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/session/:key -> kiểm tra trạng thái phiên theo session_key
export async function getSessionStatus(req, res, next) {
  try {
    const { key } = req.params;
    if (!key) return res.status(400).json({ error: 'Missing session key' });
    const row = await sessionRepo.getBySessionKey(key);
    if (!row) return res.status(404).json({ ok: false, exists: false });
    res.json({ ok: true, exists: true, account_id: row.account_id, updated_at: row.updated_at });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/sessions?key=...
export async function listSessions(req, res, next) {
  try {
    const key = typeof req.query?.key === 'string' ? req.query.key.trim() : null;
    if (!key) return res.status(400).json({ error: 'Missing session key' });
    const items = await sessionRepo.listBySessionKey(key, true);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout -> stop listener and deactivate session
// Accepts optional session key in body or query (?key=...). If missing, will attempt to logout the latest active session.
export async function logoutSession(req, res, next) {
  try {
    const keyFromQuery = typeof req.query?.key === 'string' ? req.query.key.trim() : null;
    const keyFromBody = typeof req.body?.key === 'string' ? req.body.key.trim() : null;
    const key = keyFromBody || keyFromQuery || null;
    const accountIdFromQuery = typeof req.query?.account_id === 'string' ? req.query.account_id.trim() : null;
    const accountIdFromBody = typeof req.body?.account_id === 'string' ? req.body.account_id.trim() : null;
    const targetAccountId = accountIdFromBody || accountIdFromQuery || null;

    // Resolve target session
    let session = null;
    if (key) {
      session = await sessionRepo.getBySessionKey(key, targetAccountId || undefined);
      if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    } else {
      session = await sessionRepo.getActiveSession();
      if (!session) return res.status(404).json({ ok: false, error: 'No active session' });
    }

    const { session_key, account_id } = session;

    // Stop listeners gracefully (by both identifiers to be safe)
    try { await stopListener(String(session_key)); } catch (_) {}
    const stopAcc = targetAccountId || account_id;
    if (stopAcc) { try { await stopListener(String(stopAcc)); } catch (_) {} }

    // Deactivate the session record
    try { await sessionRepo.deleteSessionByKey(session_key, targetAccountId || undefined); } catch (e) {
      return res.status(500).json({ ok: false, error: 'Failed to deactivate session', detail: e?.message || String(e) });
    }

    return res.json({ ok: true, session_key, account_id: (targetAccountId || account_id || null) });
  } catch (err) {
    next(err);
  }
}
