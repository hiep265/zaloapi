import { Zalo, ThreadType } from 'zca-js';
import { listActiveSessions, setAccountIdBySessionKey, deleteSessionByKey, getBySessionKey } from '../repositories/session.repository.js';
import { saveIncomingMessage, markMessageReplied } from '../repositories/message.repository.js';
import { acquireLock, releaseLock, renewLock } from '../utils/lock.js';
import { chatWithDangbaiLinhKien, chatWithMobileChatbot } from '../utils/dangbaiClient.js';
import { sendTextMessage, sendLink } from './sendMessage.service.js';
import { detectLinks } from '../utils/messageUtils.js';

const activeListeners = new Map(); // account_id -> { api, stop, session_key }
const stopRequests = new Set(); // keys we explicitly asked to stop (no auto-restart)
const authFailureFlags = new Set(); // keys that had auth failures (avoid auto-restart)

function extractCookie(cookies_json) {
  if (!cookies_json) return null;
  try {
    // Helper: build header from array of { key, value }
    const buildFromArray = (arr) => {
      try {
        const parts = (arr || [])
          .filter((it) => it && typeof it.key === 'string' && typeof it.value === 'string')
          .map((it) => `${it.key}=${it.value}`);
        return parts.length ? parts.join('; ') : null;
      } catch { return null; }
    };
    // Case 0: Buffer/Uint8Array returned by driver
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(cookies_json)) {
      const text = cookies_json.toString('utf8');
      try {
        const obj = JSON.parse(text);
        if (Array.isArray(obj)) return obj; // prefer native array for zca-js
        if (obj && typeof obj.cookie === 'string' && obj.cookie.trim()) return obj.cookie;
        if (obj && typeof obj.cookies === 'string' && obj.cookies.trim()) return obj.cookies;
      } catch {
        if (text && text.trim()) return text.trim();
      }
    }
    // Some drivers may give Uint8Array
    if (typeof cookies_json === 'object' && cookies_json && cookies_json.constructor && cookies_json.constructor.name === 'Uint8Array') {
      const text = Buffer.from(cookies_json).toString('utf8');
      try {
        const obj = JSON.parse(text);
        if (Array.isArray(obj)) return obj; // prefer native array
        if (obj && typeof obj.cookie === 'string' && obj.cookie.trim()) return obj.cookie;
        if (obj && typeof obj.cookies === 'string' && obj.cookies.trim()) return obj.cookies;
      } catch {
        if (text && text.trim()) return text.trim();
      }
    }
    // Case 1: stored as JSON text string
    if (typeof cookies_json === 'string') {
      try {
        const obj = JSON.parse(cookies_json);
        if (Array.isArray(obj)) {
          return obj;
        }
        if (obj && typeof obj.cookie === 'string' && obj.cookie.trim()) return obj.cookie;
        if (obj && typeof obj.cookies === 'string' && obj.cookies.trim()) return obj.cookies;
        // If JSON parse ok but no known key, fall through
      } catch {
        // Not JSON text; maybe it is already the raw cookie string
        if (cookies_json.trim()) return cookies_json.trim();
      }
    }
    // Case 2: stored as JSONB object via pg -> driver returns object
    if (typeof cookies_json === 'object' && cookies_json !== null) {
      if (Array.isArray(cookies_json)) {
        return cookies_json;
      }
      if (typeof cookies_json.cookie === 'string' && cookies_json.cookie.trim()) return cookies_json.cookie;
      if (typeof cookies_json.cookies === 'string' && cookies_json.cookies.trim()) return cookies_json.cookies;
      // Some drivers may wrap inside { cookie: { value: '...' } }
      if (cookies_json.cookie && typeof cookies_json.cookie.value === 'string') return cookies_json.cookie.value;
    }
    return null;
  } catch (e) {
    console.warn('[Listener] extractCookie error:', e.message);
    return null;
  }
}

export async function startAllListeners() {
  const sessions = await listActiveSessions();
  console.log('[Listener] starting for active sessions:', sessions.length);
  for (const s of sessions) {
    try {
      await startListenerForSession(s);
    } catch (e) {
      console.error('[Listener] failed to start for', s.session_key, e.message);
    }
  }
}

export async function startListenerForSession(sessionRow) {
  try {
    const { session_key, account_id, cookies_json, imei, user_agent, language, api_key } = sessionRow;
    const cookie = extractCookie(cookies_json);
    if (!cookie) {
      // avoid printing full cookie_json; print type and keys to debug shape
      const shape = cookies_json ? (typeof cookies_json === 'string' ? 'string' : `object keys: ${Object.keys(cookies_json||{}).join(',')}`) : 'null';
      console.warn('[Listener] missing cookie for', session_key, 'cookies_json shape:', shape);
      return;
    }

    const accKey = account_id || session_key;
    
    // Check if already running first, before acquiring lock
    if (activeListeners.has(accKey)) {
      console.log('[Listener] already running', accKey);
      return;
    }
    
    const lockKey = `zalo:listener:account:${accKey}`;
    const locked = await acquireLock(lockKey, 60);
    if (!locked) {
      console.log('[Listener] lock busy skip', accKey);
      // Only retry if we're not already running
      if (!activeListeners.has(accKey)) {
        setTimeout(() => startListenerForSession(sessionRow).catch(console.error), 3000);
      }
      return;
    }

    // Double-check after acquiring lock
    if (activeListeners.has(accKey)) {
      await releaseLock(lockKey);
      console.log('[Listener] already running after lock', accKey);
      return;
    }

    const zalo = new Zalo({ checkUpdate: false, selfListen: true });
    let api;
    try {
      const cookieLen = Array.isArray(cookie) ? cookie.length : (cookie || '').length;
      console.log('[Listener] login for', accKey, 'cookie.len=', cookieLen, Array.isArray(cookie) ? '(array)' : '(string)');
      api = await zalo.login({ cookie, imei, userAgent: user_agent, language: language || 'vi' });
    } catch (e) {
      const msg = e?.message || String(e);
      console.warn('[Listener] login error for', accKey, msg);
      // DEBUG chi tiết: ghi lại toàn bộ object lỗi để xem thông tin Zalo/zcajs trả về
      try {
        console.error('[Listener][DEBUG] login error object =', e);
        if (e && typeof e === 'object') {
          const basic = { name: e.name, message: e.message, stack: e.stack, code: e.code, status: e.status };
          console.error('[Listener][DEBUG] login error fields =', basic);
          if (e.response) console.error('[Listener][DEBUG] login e.response =', e.response);
          if (e.data) console.error('[Listener][DEBUG] login e.data =', e.data);
          if (e.body) console.error('[Listener][DEBUG] login e.body =', e.body);
          if (e.cause) console.error('[Listener][DEBUG] login e.cause =', e.cause);
        }
      } catch (_) {}
      
      // PHÁT HIỆN LỖI XÁC THỰC NGAY SAU KHI LOGIN
      // - Nếu người dùng đăng nhập Zalo ở nơi khác (Web/App) hoặc cookie/phiên đã hết hạn,
      //   Zalo sẽ trả về thông báo chứa các từ khóa bên dưới.
      // - Khi phát hiện lỗi dạng này: vô hiệu hóa (deactivate) session trong DB để tránh tự khởi động lại sai.
      const isAuthFailure = msg.includes('authentication') || 
                           msg.includes('unauthorized') || 
                           msg.includes('invalid') ||
                           msg.includes('expired') ||
                           msg.includes('login') ||
                           msg.toLowerCase().includes('auth') ||
                           msg.includes('Đăng nhập thất bại') ||
                           msg.includes('Cookie not in this host') ||
                           msg.includes('domain');
      
      if (isAuthFailure) {
        console.warn('[Listener] authentication failure detected, deactivating session:', session_key);
        // Hành động: đặt sessions.is_active=false để ngăn start lại cho đến khi người dùng đăng nhập lại.
        try {
          await deleteSessionByKey(session_key);
          console.log('[Listener] session deactivated due to auth failure:', session_key);
        } catch (deleteErr) {
          console.error('[Listener] failed to deactivate session:', session_key, deleteErr.message);
        }
        // Don't retry for auth failures - user needs to login again
        await releaseLock(lockKey);
        return;
      }
      
      // For other errors, release lock and retry later (backoff 10s)
      await releaseLock(lockKey);
      setTimeout(() => startListenerForSession(sessionRow).catch(console.error), 10000);
      return;
    }

    // Ensure we know our own account_id (uid)
    let accId = account_id;
    if (!accId) {
      try {
        accId = await api.getOwnId();
        if (accId) {
          await setAccountIdBySessionKey(session_key, String(accId));
          console.log('[Listener] populated account_id for session', session_key, '=>', accId);
        }
      } catch (e) {
        console.warn('[Listener] getOwnId failed:', e?.message || String(e));
      }
    }

    api.listener.on('message', async (message) => {
    try {
      const d = message?.data || {};
      // // DEBUG: Log full raw message and data payload from Zalo
      // try {
      //   console.log('[DEBUG] Zalo raw message =', JSON.stringify(message, null, 2));
      // } catch (_) {
      //   console.log('[DEBUG] Zalo raw message (non-serializable) =', message);
      // }
      // try {
      //   console.log('[DEBUG] Zalo raw data d =', JSON.stringify(d, null, 2));
      // } catch (_) {
      //   console.log('[DEBUG] Zalo raw data d (non-serializable) =', d);
      // }
      const isText = typeof d.content === 'string';
      const isPhoto = d.msgType === 'chat.photo' && typeof d.content === 'object' && d.content !== null;
      
      if (!isText && !isPhoto) {
        console.log('[Listener] skip unsupported message', {
          type: message?.type,
          msgType: d.msgType,
          hasContent: typeof d.content,
          keys: Object.keys(d || {}),
        });

    // Lắng nghe sự kiện WebSocket bị ngắt kết nối để thu thập code/reason chi tiết
    api.listener.on('disconnected', async (code, reason) => {
      // Các mã thường gặp từ zca-js: 3000 (DuplicateConnection), 3003 (KickConnection)
      console.warn('[Listener] disconnected', accKey, 'code=', code, 'reason=', reason);
    });

    // Khi socket đóng hẳn: xử lý như stop, và nếu là Kick/Duplicate coi như mất phiên đăng nhập
    api.listener.on('closed', async (code, reason) => {
      console.warn('[Listener] closed', accKey, 'code=', code, 'reason=', reason);
      const h = activeListeners.get(accKey);
      if (h?.healthCheckId) { try { clearInterval(h.healthCheckId); } catch {} }
      if (h?.lockRenewId) { try { clearInterval(h.lockRenewId); } catch {} }
      activeListeners.delete(accKey);
      try { await releaseLock(lockKey); } catch {}

      // Nếu đây là đóng do đăng nhập nơi khác hoặc kết nối trùng lặp ⇒ vô hiệu hóa session
      const isKickOrDuplicate = Number(code) === 3003 || Number(code) === 3000;
      if (isKickOrDuplicate) {
        try {
          await deleteSessionByKey(session_key);
          console.log('[Listener] session deactivated due to closed code', code, 'session=', session_key);
        } catch (e) {
          console.error('[Listener] failed to deactivate session on closed:', session_key, e?.message || e);
        }
        return;
      }
      // Nếu có yêu cầu dừng chủ động, không làm gì thêm
      if (stopRequests.has(String(accKey))) {
        try { stopRequests.delete(String(accKey)); } catch {}
        return;
      }
      // Mặc định: không auto-restart; yêu cầu đăng nhập lại nếu cần
    });
        return;
      }

      // Map fields from zca-js payload
      const fromUid = d.uidFrom || d.senderId || null; // người gửi
      const toUid = d.idTo || d.userId || d.groupId || null; // đích đến
      const msgId = d.msgId || d.messageId || `${Date.now()}-${Math.random()}`;
      
      // Handle content based on message type
      let content;
      if (isText) {
        content = d.content;
      } else if (isPhoto) {
        // For photo messages, store the image URL and metadata
        content = JSON.stringify({
          type: 'photo',
          href: d.content.href,
          thumb: d.content.thumb,
          title: d.content.title || '',
          description: d.content.description || '',
          params: d.content.params || '',
          width: d.content.params ? (() => {
            try {
              return JSON.parse(d.content.params || '{}').width;
            } catch (e) {
              console.warn('[Listener] Failed to parse params for width:', e.message);
              return null;
            }
          })() : null,
          height: d.content.params ? (() => {
            try {
              return JSON.parse(d.content.params || '{}').height;
            } catch (e) {
              console.warn('[Listener] Failed to parse params for height:', e.message);
              return null;
            }
          })() : null,
        });
      }
      
      const msgType = d.msgType || d.type || null;
      const cmd = typeof d.cmd !== 'undefined' ? Number(d.cmd) : null;
      const ts = d.ts ? Number(d.ts) : null;
      const threadId = message?.threadId || d.threadId || null;

      // Suy luận peer_id
      // - Group: nếu không có d.groupId thì dùng threadId khi type === 1 (group)
      // - 1-1: dùng 'đối phương' làm peer_id (out -> toUid, in -> fromUid)
      const inferredGroupId = d.groupId || (d.type === 1 ? (threadId || null) : null);
      const isGroup = !!inferredGroupId || d.type === 1 || message?.type === 1;
      const threadType = isGroup ? ThreadType.Group : ThreadType.User;
      const direction = (fromUid && accId && String(fromUid) === String(accId)) ? 'out' : 'in';
      const peerId = isGroup
        ? (threadId || inferredGroupId)
        : (direction === 'out' ? (toUid || d.idTo || d.userId || null) : (fromUid || d.uidFrom || d.senderId || null));

      // Fetch group info if this is a group message
      let groupName = null;
      if (isGroup && (threadId || inferredGroupId)) {
        try {
          const gid = threadId || inferredGroupId;
          const groupInfo = await api.getGroupInfo(gid);
          if (groupInfo?.gridInfoMap?.[gid]?.name) {
            groupName = groupInfo.gridInfoMap[gid].name;
            console.log('[Listener] fetched group name:', groupName, 'for groupId:', gid);
          }
        } catch (groupErr) {
          console.warn('[Listener] failed to fetch group info for', threadId || inferredGroupId, ':', groupErr?.message || groupErr);
        }
      }

      console.log('[Listener] message received', {
        session_key,
        account_id: accId || account_id,
        direction,
        peerId,
        msgId,
        msgType,
      });

      // Normalize d_name to always mean: "tên của hội thoại/đối phương" (owner of the conversation)
      // Theo yêu cầu:
      // - Nếu tin nhắn là của tài khoản hiện tại (is_self === true) -> KHÔNG lưu d_name (để null)
      // - Nếu không phải self:
      //    + Group: dùng groupName
      //    + 1-1: dùng tên người gửi (d.dName)
      const isSelf = (typeof message?.isSelf === 'boolean') ? message.isSelf : (direction === 'out');
      const normalizedDName = isSelf
        ? null
        : (isGroup ? (groupName || null) : (d.dName || null));

      await saveIncomingMessage({
        session_key,
        account_id: isSelf ? (d.idTo || null) : (d.uidFrom || null),
        // New Zalo message fields
        type: d.type,
        thread_id: threadId,
        id_to: d.idTo,
        uid_from: d.uidFrom,
        d_name: normalizedDName, // Always the conversation owner (group name or counterpart's name)
        group_name: groupName, // Store group name separately
        is_self: isSelf,
        content,
        msg_type: d.msgType,
        property_ext: d.propertyExt,
        quote: d.quote,
        mentions: d.mentions,
        attachments_json: message?.data?.attachments || null,
        ts: d.ts,
        msg_id: msgId,
        cli_msg_id: d.cliMsgId,
        global_msg_id: d.globalMsgId,
        real_msg_id: d.realMsgId,
        cmd: d.cmd,
        st: d.st,
        status: d.status,
        ttl: d.ttl,
        notify: d.notify,
        top_out: d.topOut,
        top_out_time_out: d.topOutTimeOut,
        top_out_impr_time_out: d.topOutImprTimeOut,
        action_id: d.actionId,
        uin: d.uin,
        user_id: d.userId,
        params_ext: d.paramsExt,
        raw_json: message,
        // Legacy compatibility fields
        thread_type: threadType,
        peer_id: String(peerId || ''),
        direction,
        message_id: String(msgId),
        from_uid: fromUid ? String(fromUid) : null,
        to_uid: toUid ? String(toUid) : null,
      });

      // Auto-reply: spawn a separate async task to call Dangbai chatbot backend
      // Conditions: only for inbound text messages (not self messages)
      if (!isSelf && isText && typeof content === 'string' && content.trim()) {
        // Fire-and-forget; do not block listener loop
        (async () => {
          try {
            // Fetch latest session row to avoid stale data (priority/api_key may change at runtime)
            let latest = null;
            try { latest = await getBySessionKey(session_key); } catch (_) { latest = null; }
            const effectivePriority = (latest?.chatbot_priority || sessionRow?.chatbot_priority || 'mobile').toLowerCase();
            const effectiveApiKey = latest?.api_key || api_key || undefined;

            let resp = null;
            if (effectivePriority === 'custom') {
              // Call custom chatbot (linhkien)
              resp = await chatWithDangbaiLinhKien({
                message: content,
                model_choice: 'gemini',
                session_id: threadId,
                apiKey: effectiveApiKey,
              });
            } else {
              // Default or 'mobile' -> call mobile chatbot
              resp = await chatWithMobileChatbot({
                query: content,
                stream: false,
                llm_provider: 'google_genai',
                apiKey: effectiveApiKey,
                thread_id: threadId,
              });
            }

             if (!resp) return;

            // Extract text to reply from various possible response shapes
            let replyMsg = null;
            if (typeof resp === 'string') {
              replyMsg = resp.trim();
            } else if (typeof resp?.reply === 'string') {
              replyMsg = resp.reply.trim();
            } else if (typeof resp?.data?.answer === 'string') {
              replyMsg = resp.data.answer.trim();
            } else if (typeof resp?.message === 'string') {
              replyMsg = resp.message.trim();
            } else if (typeof resp?.response === 'string') {
              // Mobile chatbot response shape
              replyMsg = resp.response.trim();
            } else if (typeof resp?.text === 'string') {
              replyMsg = resp.text.trim();
            } else if (resp && typeof resp === 'object') {
              try {
                const s = JSON.stringify(resp);
                replyMsg = s.length > 1800 ? s.slice(0, 1800) + '…' : s;
              } catch (_) { /* ignore */ }
            }

            if (!replyMsg) return;
            // Limit message length to avoid platform limits
            if (replyMsg.length > 2000) replyMsg = replyMsg.slice(0, 2000);

            let sendRes = null;
            
            // Prefer structured images from response if provided
            const images = Array.isArray(resp?.images) ? resp.images : [];
            if (images.length > 0) {
              // Send the reply text first (once), but strip any links from it
              if (replyMsg) {
                const { textWithoutLinks } = detectLinks(replyMsg);
                if (textWithoutLinks) {
                  sendRes = await sendTextMessage({ api, threadId, msg: textWithoutLinks, type: threadType });
                }
              }
              for (const img of images) {
                try {
                  const linkUrl = img?.image_url || img?.url || '';
                  if (!linkUrl) continue;
                  const caption = [img?.product_name, img?.product_link].filter(Boolean).join('\n');
                  const linkRes = await sendLink({
                    api,
                    threadId,
                    link: String(linkUrl),
                    msg: caption || undefined,
                    type: threadType,
                  });
                  if (linkRes) sendRes = linkRes;
                } catch (e) {
                  console.warn('[Listener] send image link failed:', e?.message || String(e));
                }
              }
            } else {
              // Fallback: detect links in plain reply text, else send as text
              const { hasLinks, links, textWithoutLinks } = detectLinks(replyMsg);
              if (hasLinks && links.length > 0) {
                // Send the cleaned text first (if exists), then send each link separately
                if (textWithoutLinks && textWithoutLinks.length > 0) {
                  try {
                    const textRes = await sendTextMessage({ api, threadId, msg: textWithoutLinks, type: threadType });
                    if (textRes) sendRes = textRes;
                  } catch (_) { /* ignore */ }
                }
                for (const link of links) {
                  try {
                    const linkRes = await sendLink({ api, threadId, link: link, type: threadType });
                    if (linkRes) sendRes = linkRes;
                  } catch (_) { /* ignore */ }
                }
              } else {
                sendRes = await sendTextMessage({ api, threadId, msg: replyMsg, type: threadType });
              }
            }
            
            if (sendRes) { await markMessageReplied(session_key, msgId); }
          } catch (e) {
            console.error('[Listener] auto-reply error', e.message || e);
          }
        })();
      }
    } catch (err) {
      console.error('[Listener] handle message error', err.message || err);
    }
  });

    api.listener.on('stop', async () => {
      console.warn('[Listener] stopped', accKey);
      const h = activeListeners.get(accKey);
      // Clear timers
      if (h?.healthCheckId) { try { clearInterval(h.healthCheckId); } catch {} }
      if (h?.lockRenewId) { try { clearInterval(h.lockRenewId); } catch {} }
      activeListeners.delete(accKey);
      await releaseLock(lockKey);
      // If this stop was explicitly requested (e.g., logout), do NOT auto-restart
      if (stopRequests.has(String(accKey))) {
        stopRequests.delete(String(accKey));
        return;
      }
      // Deactivate session on unexpected stop (likely due to user opening Zalo Web/App)
      try {
        await deleteSessionByKey(session_key);
        console.log('[Listener] session deactivated due to stop event:', session_key);
      } catch (e) {
        console.error('[Listener] failed to deactivate session on stop:', session_key, e?.message || e);
      }
    });

    // Add global error handler for the listener
    api.listener.on('error', async (error) => {
      const errMsg = error?.message || String(error || '');
      console.error('[Listener] Listener error for', accKey, ':', errMsg);
      // DEBUG chi tiết: ghi lại toàn bộ object lỗi runtime
      try {
        console.error('[Listener][DEBUG] runtime error object =', error);
        if (error && typeof error === 'object') {
          const basic = { name: error.name, message: error.message, stack: error.stack, code: error.code, status: error.status };
          console.error('[Listener][DEBUG] runtime error fields =', basic);
          if (error.response) console.error('[Listener][DEBUG] runtime error response =', error.response);
          if (error.data) console.error('[Listener][DEBUG] runtime error data =', error.data);
          if (error.body) console.error('[Listener][DEBUG] runtime error body =', error.body);
          if (error.cause) console.error('[Listener][DEBUG] runtime error cause =', error.cause);
        }
      } catch (_) {}
      // PHÁT HIỆN LỖI XÁC THỰC TRONG QUÁ TRÌNH ĐANG CHẠY
      // - Trong lúc listener hoạt động, nếu session hết hạn/đăng nhập nơi khác,
      //   các lỗi thường chứa các từ khóa bên dưới.
      // - Khi gặp lỗi auth: vô hiệu hóa session và dừng listener, KHÔNG tự khởi động lại.
      const isAuthFailure = typeof errMsg === 'string' && (
        errMsg.toLowerCase().includes('auth') ||
        errMsg.toLowerCase().includes('unauthorized') ||
        errMsg.toLowerCase().includes('forbidden') ||
        errMsg.toLowerCase().includes('invalid') ||
        errMsg.toLowerCase().includes('expired') ||
        errMsg.includes('Đăng nhập thất bại') ||
        errMsg.includes('Cookie not in this host') ||
        errMsg.toLowerCase().includes('token') ||
        errMsg.toLowerCase().includes('domain')
      );

      if (isAuthFailure) {
        console.warn('[Listener] auth error detected during run; deactivating session and stopping listener:', session_key);
        // Mark flags so 'stop' handler does not auto-restart
        try { authFailureFlags.add(String(accKey)); } catch {}
        try { authFailureFlags.add(String(session_key)); } catch {}
        try { stopRequests.add(String(accKey)); } catch {}
        try { stopRequests.add(String(session_key)); } catch {}
        // Deactivate session in DB so it won't be started again
        try {
          await deleteSessionByKey(session_key);
          console.log('[Listener] session deactivated due to runtime auth failure:', session_key);
        } catch (e) {
          console.error('[Listener] failed to deactivate session on runtime auth failure:', session_key, e?.message || e);
        }
        // Stop listener and release lock; 'stop' handler will clean up
        try { api.listener.stop(); } catch {}
        try { await releaseLock(lockKey); } catch {}
      }
      // For non-auth errors, just log; we rely on the internal listener to keep running
    });

    api.listener.start();

    // Proactive health check to detect silent session expiry
    const healthCheckInterval = setInterval(async () => {
      console.log(`[Listener] Running health check for ${accKey}...`);
      try {
        // Dùng API có gọi mạng để xác thực phiên thật sự còn sống (getOwnId chỉ trả về uid cache)
        // keepAlive là nhẹ và phù hợp để kiểm tra phiên.
        if (typeof api.keepAlive === 'function') {
          await api.keepAlive();
        } else if (typeof api.getContext === 'function') {
          await api.getContext();
        } else if (typeof api.fetchAccountInfo === 'function') {
          await api.fetchAccountInfo();
        } else {
          // Fallback cuối: gọi getOwnId nhưng không đảm bảo phát hiện hết hạn
          const ownId = await api.getOwnId();
          if (!ownId) throw new Error('ownId missing');
        }
        console.log(`[Listener] Health check PASSED for ${accKey}.`);
      } catch (healthError) {
        // Ghi log đầy đủ để chuẩn đoán nguyên nhân lỗi khi kiểm tra sức khỏe (health check)
        console.error('[Listener] Health check FAILED. Full error object:', healthError);

        const errMsg = healthError?.message || String(healthError || '');
        // PHÁT HIỆN LỖI XÁC THỰC QUA HEALTH CHECK
        // - Nếu getOwnId() thất bại với các từ khóa dưới đây, hiểu là session đã hết hạn
        //   hoặc bị đăng nhập từ nơi khác → cần vô hiệu hóa session và dừng listener.
        const isAuthFailure = typeof errMsg === 'string' && (
          errMsg.toLowerCase().includes('auth') ||
          errMsg.toLowerCase().includes('unauthorized') ||
          errMsg.toLowerCase().includes('forbidden') ||
          errMsg.toLowerCase().includes('invalid') ||
          errMsg.toLowerCase().includes('expired') ||
          errMsg.includes('Đăng nhập thất bại') ||
          errMsg.includes('Cookie not in this host') ||
          errMsg.toLowerCase().includes('token') ||
          errMsg.toLowerCase().includes('domain')
        );

        if (isAuthFailure) {
          console.warn('[Listener] Health check failed, auth error detected; deactivating session:', session_key);
          // Hành động: đánh dấu session không còn active để yêu cầu đăng nhập lại
          // Mark flags to prevent auto-restart
          try { authFailureFlags.add(String(accKey)); } catch {}
          try { authFailureFlags.add(String(session_key)); } catch {}
          // Deactivate session in DB
          try {
            await deleteSessionByKey(session_key);
            console.log('[Listener] Session deactivated due to health check failure:', session_key);
          } catch (e) {
            console.error('[Listener] Failed to deactivate session on health check failure:', session_key, e?.message || e);
          }
          // Stop the listener and clean up
          if (activeListeners.has(accKey)) {
            const h = activeListeners.get(accKey);
            if (h && h.healthCheckId) {
              clearInterval(h.healthCheckId);
            }
            try { h.stop(); } catch {}
          }
        }
      }
    }, 30000); // Kiểm tra sức khỏe mỗi 5 phút

    // Periodically renew the multi-layer lock to keep it alive while listener is running
    const lockRenewInterval = setInterval(async () => {
      try {
        const ok = await renewLock(lockKey, 60);
        if (!ok) {
          console.warn('[Listener] lock renew failed, stopping listener to avoid duplicates', accKey);
          try { api.listener.stop(); } catch {}
        }
      } catch (e) {
        console.warn('[Listener] lock renew error:', e?.message || e);
      }
    }, 2000); // renew every 20s (less than TTL)

    activeListeners.set(accKey, { api, stop: () => api.listener.stop(), session_key, healthCheckId: healthCheckInterval, lockRenewId: lockRenewInterval });
    console.log('[Listener] started', accKey);
  } catch (error) {
    console.error('[Listener] Failed to start listener for session', sessionRow?.session_key, ':', error.message || error);
    // Optionally retry after a delay
    if (sessionRow?.session_key) {
      setTimeout(() => {
        console.log('[Listener] Retrying to start listener for session', sessionRow.session_key);
        startListenerForSession(sessionRow).catch(console.error);
      }, 10000); // Retry after 10 seconds
    }
  }
}

export function listRunning() {
  return Array.from(activeListeners.keys());
}

export async function stopListener(accountIdOrSessionKey) {
  const h = activeListeners.get(accountIdOrSessionKey);
  if (h) {
    // Clear health check first
    if (h.healthCheckId) {
      clearInterval(h.healthCheckId);
    }
    if (h.lockRenewId) {
      clearInterval(h.lockRenewId);
    }
    // Mark this key (and the paired session key if present) to prevent auto-restart
    try { stopRequests.add(String(accountIdOrSessionKey)); } catch {}
    if (h && h.session_key) {
      try { stopRequests.add(String(h.session_key)); } catch {}
    }
    try { h.stop(); } catch {}
    activeListeners.delete(accountIdOrSessionKey);
  }
  // Wait a moment for the listener to fully stop before releasing locks
  await new Promise(r => setTimeout(r, 500));

  // Always release lock(s) so a fresh start isn't blocked
  try { await releaseLock(`zalo:listener:account:${accountIdOrSessionKey}`); } catch {}
  // Also try to release by the paired identifier if we have it
  if (h && h.session_key) {
    try { await releaseLock(`zalo:listener:account:${h.session_key}`); } catch {}
  }
}

export default { startAllListeners, startListenerForSession, listRunning, stopListener };
