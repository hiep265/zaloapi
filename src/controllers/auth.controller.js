import { createRequire } from 'module';
import { startListenerForSession } from '../services/listenerManager.js';
import * as sessionRepo from '../repositories/session.repository.js';

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

    // Start login QR with callback streaming events
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
                  const api = await new Zalo().loginCookie({ cookie: cookies, imei, userAgent: ua, language: 'vi' });
                  if (api && typeof api.getOwnId === 'function') {
                    uid = await api.getOwnId();
                    console.log('Successfully got user ID:', uid);
                  } else {
                    console.warn('Zalo API instance invalid or missing getOwnId');
                  }
                } catch (loginErr) {
                  console.error('Zalo loginCookie/getOwnId error:', loginErr?.message || String(loginErr));
                }
                // Chuẩn hoá cookies_json thành JSON hợp lệ cho cột JSONB
                const cookiesJsonPayload = typeof cookies === 'string'
                  ? { cookie: cookies }
                  : (cookies || {});
                const cookiesJsonText = JSON.stringify(cookiesJsonPayload);

                // Save session data
                try {
                  if (sessionKey) {
                    await sessionRepo.upsertBySessionKey({
                      session_key: sessionKey,
                      account_id: uid || null,
                      cookies_json: cookiesJsonText,
                      imei: imei || null,
                      user_agent: ua,
                      language: 'vi',
                    });
                    console.log('Session saved with key:', sessionKey);
                  } else {
                    await sessionRepo.upsertActiveSession({
                      account_id: uid || null,
                      cookies_json: cookiesJsonText,
                      imei: imei || null,
                      user_agent: ua,
                      language: 'vi',
                    });
                    console.log('Active session saved');
                  }
                  // Kick off listener for this session immediately
                  try {
                    await startListenerForSession({
                      session_key: sessionKey || null,
                      account_id: uid || null,
                      cookies_json: cookiesJsonText,
                      imei: imei || null,
                      user_agent: ua,
                      language: 'vi',
                      is_active: true,
                    });
                    console.log('[Listener] start requested for session', sessionKey);
                  } catch (e) {
                    console.warn('[Listener] start failed', e?.message || String(e));
                  }
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
                const api = await new Zalo().loginCookie({ cookie: cookies, imei, userAgent: ua, language: 'vi' });
                const uid = await api.getOwnId();
                if (sessionKey) {
                  await sessionRepo.upsertBySessionKey({
                    session_key: sessionKey,
                    account_id: uid || null,
                    cookies_json: cookies || null,
                    imei: imei || null,
                    user_agent: ua,
                    language: 'vi',
                  });
                } else {
                  await sessionRepo.upsertActiveSession({
                    account_id: uid || null,
                    cookies_json: cookies || null,
                    imei: imei || null,
                    user_agent: ua,
                    language: 'vi',
                  });
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
