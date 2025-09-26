import { Zalo, ThreadType } from 'zca-js';
import { listActiveSessions, setAccountIdBySessionKey, deleteSessionByKey, getBySessionKey } from '../repositories/session.repository.js';
import { saveIncomingMessage, markMessageReplied } from '../repositories/message.repository.js';
import { acquireLock, releaseLock, renewLock } from '../utils/lock.js';
import { chatWithDangbaiLinhKien, chatWithMobileChatbot } from '../utils/dangbaiClient.js';
import { sendTextMessage, sendLink } from './sendMessage.service.js';
import { detectLinks } from '../utils/messageUtils.js';
import { list as listIgnored } from '../repositories/ignoredConversations.repository.js';
import { getBySessionKeyAndZaloUid as getStaffBySessionKeyAndZaloUid } from '../repositories/staff.repository.js';
import { getBySessionKey as getBotConfigBySessionKey } from '../repositories/botConfig.repository.js';

const activeListeners = new Map(); // account_id -> { api, stop, session_key }
const stopRequests = new Set(); // keys we explicitly asked to stop (no auto-restart)
const authFailureFlags = new Set(); // keys that had auth failures (avoid auto-restart)

// Reconnection control: track retry counts and in-flight restart requests/timers
const reconnectAttempts = new Map(); // key => number of attempts since last successful start
const restartRequests = new Set(); // keys we intentionally stop() to restart, so 'stop' handler won't deactivate
const reconnectTimers = new Map(); // key => timer id to avoid double scheduling

function scheduleReconnect(accKey, sessionRow, delayMs = 3000) {
  try {
    const key = String(accKey);
    // Avoid double-scheduling if multiple events ('disconnected' and 'closed') fire together
    if (reconnectTimers.has(key)) {
      return;
    }
    console.log('[Listener] scheduling reconnect for', key, 'in', delayMs, 'ms');
    const timer = setTimeout(async () => {
      reconnectTimers.delete(key);
      const prev = Number(reconnectAttempts.get(key) || 0) + 1;
      reconnectAttempts.set(key, prev);
      if (prev <= 3) {
        console.log('[Listener] reconnect attempt', `${prev}/3`, 'for', key);
        try {
          await startListenerForSession(sessionRow);
        } catch (e) {
          console.error('[Listener] reconnect start failed:', e?.message || e);
        }
      } else {
        console.warn('[Listener] max reconnect attempts reached; deactivating session:', sessionRow?.session_key);
        try {
          await deleteSessionByKey(sessionRow?.session_key);
        } catch (e) {
          console.error('[Listener] failed to deactivate session after max retries:', sessionRow?.session_key, e?.message || e);
        }
        try { reconnectAttempts.delete(key); } catch {}
      }
    }, delayMs);
    reconnectTimers.set(key, timer);
  } catch (e) {
    console.warn('[Listener] scheduleReconnect error:', e?.message || e);
  }
}

// Suppression map: per-thread auto-reply suppression when staff speaks
const DEFAULT_SUPPRESS_MINUTES = 10; // Fallback if no bot_configs
const threadSuppression = new Map(); // key = `${session_key}:${threadId}` => expiry timestamp (ms)

// Self-message tracking: detect user vs bot messages
const lastBotReplyTime = new Map(); // key = `${session_key}:${threadId}` => timestamp
const SELF_MESSAGE_GRACE_PERIOD = 3000; // 3 seconds - if self message appears within this time after bot reply, consider it from bot

// Periodic cleanup for lastBotReplyTime to prevent memory leak
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [key, timestamp] of lastBotReplyTime.entries()) {
    // Remove entries older than 2x grace period (6 seconds)
    if (now - timestamp > SELF_MESSAGE_GRACE_PERIOD * 2) {
      lastBotReplyTime.delete(key);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    console.log(`[Listener] Cleaned up ${cleanedCount} old bot reply entries. Current size: ${lastBotReplyTime.size}`);
  }
}, 5 * 60 * 1000); // Cleanup every 5 minutes

async function getSuppressMs(session_key) {
  try {
    const cfg = await getBotConfigBySessionKey(String(session_key || ''));
    // If no config found or missing stop_minutes -> default 10 minutes
    if (!cfg || cfg.stop_minutes == null) {
      return DEFAULT_SUPPRESS_MINUTES * 60 * 1000;
    }
    const minutes = Number(cfg.stop_minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_SUPPRESS_MINUTES * 60 * 1000;
    return minutes * 60 * 1000;
  } catch (_) {
    return DEFAULT_SUPPRESS_MINUTES * 60 * 1000;
  }
}

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

      // Self-message suppression: if user sends message from their account (not via chatbot API)
      // then suppress auto-replies in this thread for configured minutes
      if (isSelf && isText && typeof content === 'string' && content.trim()) {
        const threadKey = `${session_key}:${threadId}`;
        const threadKeyStr = String(threadId || '');
        const lastBotTime = lastBotReplyTime.get(threadKey);
        const now = Date.now();
        
        // If no recent bot reply, or it's been too long since bot reply, 
        // then this self message is likely from user (not bot API)
        const isFromUser = !lastBotTime || (now - lastBotTime) > SELF_MESSAGE_GRACE_PERIOD;
        
        if (isFromUser && threadKeyStr) {
          // Apply suppression like staff logic
          const suppressKey = `${session_key}:${threadKeyStr}`;
          const ttl = await getSuppressMs(session_key);
          threadSuppression.set(suppressKey, Date.now() + ttl);
          console.log('[Listener] self message from user; suppress auto-replies', { 
            session_key, 
            threadId: threadKeyStr,
            suppressUntil: new Date(Date.now() + ttl).toISOString(),
            timeSinceLastBot: lastBotTime ? (now - lastBotTime) : 'no-recent-bot-activity'
          });
        } else {
          console.log('[Listener] self message likely from bot API; no suppression', {
            session_key,
            threadId: threadKeyStr,
            timeSinceLastBot: lastBotTime ? (now - lastBotTime) : 'no-recent-bot-activity'
          });
        }
        
        // Cleanup old bot reply entries if needed
        if (lastBotTime && (now - lastBotTime) > SELF_MESSAGE_GRACE_PERIOD * 2) {
          lastBotReplyTime.delete(threadKey);
        }
      }

      // Auto-reply: spawn a separate async task to call Dangbai chatbot backend
      // Conditions: only for inbound text messages (not self messages)
      if (!isSelf && isText && typeof content === 'string' && content.trim()) {
        // Pre-check 0: skip if this thread is currently suppressed due to staff activity
        const threadKeyStr = String(threadId || '');
        if (threadKeyStr) {
          const suppressKey = `${session_key}:${threadKeyStr}`;
          const now = Date.now();
          const until = threadSuppression.get(suppressKey);
          if (until && now < until) {
            console.log('[Listener] thread suppressed; skip auto-reply', { session_key, threadId: threadKeyStr, until });
            return;
          }
          if (until && now >= until) {
            try { threadSuppression.delete(suppressKey); } catch {}
          }
        }

        // Pre-check 1: if sender is a staff with role 'staff' => suppress this thread for 10 minutes and skip reply
        try {
          const staffRow = await getStaffBySessionKeyAndZaloUid(String(session_key || ''), String(fromUid || ''));
          if (staffRow && String(staffRow.role || '').toLowerCase() === 'staff') {
            if (threadKeyStr) {
              const suppressKey = `${session_key}:${threadKeyStr}`;
              const ttl = await getSuppressMs(session_key);
              threadSuppression.set(suppressKey, Date.now() + ttl);
            }
            console.log('[Listener] inbound from staff; suppress auto-replies', { session_key, threadId: threadKeyStr, fromUid });
            return;
          }
        } catch (staffErr) {
          console.warn('[Listener] staff-check failed:', staffErr?.message || staffErr);
        }

        // Fire-and-forget; do not block listener loop
        (async () => {
          try {
            // Fetch latest session row to avoid stale data (priority/api_key may change at runtime)
            let latest = null;
            try { latest = await getBySessionKey(session_key); } catch (_) { latest = null; }
            const effectivePriority = (latest?.chatbot_priority || sessionRow?.chatbot_priority || 'mobile').toLowerCase();
            const effectiveApiKey = latest?.api_key || api_key || undefined;

            // Pre-check: skip auto-reply if this thread is in user's ignored conversations
            try {
              const ignoreRows = await listIgnored({
                session_key,
                thread_id: String(threadId || ''),
                user_id: latest?.user_id || undefined,
                limit: 1,
                offset: 0,
              });
              if (Array.isArray(ignoreRows) && ignoreRows.length > 0) {
                console.log('[Listener] thread is ignored; skip auto-reply', { session_key, threadId });
                return;
              }
            } catch (ignErr) {
              console.warn('[Listener] ignore-check failed:', ignErr?.message || ignErr);
            }

            // Re-check suppression inside worker to avoid race conditions
            try {
              const threadKeyStr = String(threadId || '');
              if (threadKeyStr) {
                const suppressKey = `${session_key}:${threadKeyStr}`;
                const until = threadSuppression.get(suppressKey);
                if (until && Date.now() < until) {
                  console.log('[Listener] thread suppressed (worker); skip auto-reply', { session_key, threadId: threadKeyStr, until });
                  return;
                }
              }
            } catch (_) { /* ignore */ }

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
            
            if (sendRes) { 
              // Track bot reply time for self-message detection
              const threadKey = `${session_key}:${threadId}`;
              lastBotReplyTime.set(threadKey, Date.now());
              await markMessageReplied(session_key, msgId); 
            }
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
      if (h?.lockRenewId) { try { clearInterval(h.lockRenewId); } catch {} }
      activeListeners.delete(accKey);
      await releaseLock(lockKey);
      // If this stop was explicitly requested (e.g., logout), do NOT auto-restart
      if (stopRequests.has(String(accKey))) {
        stopRequests.delete(String(accKey));
        return;
      }
      // If this stop was triggered intentionally for restart, schedule reconnect and skip deactivation
      if (restartRequests.has(String(accKey)) || restartRequests.has(String(session_key))) {
        try { restartRequests.delete(String(accKey)); } catch {}
        try { restartRequests.delete(String(session_key)); } catch {}
        scheduleReconnect(accKey, sessionRow, 2000);
        return;
      }
      // If we already flagged auth failure earlier, do nothing (already deactivated)
      if (authFailureFlags.has(String(accKey)) || authFailureFlags.has(String(session_key))) {
        try { authFailureFlags.delete(String(accKey)); } catch {}
        try { authFailureFlags.delete(String(session_key)); } catch {}
        return;
      }
      // Otherwise: schedule reconnect attempt (up to 3 times)
      scheduleReconnect(accKey, sessionRow, 3000);
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
      } else {
        // For non-auth errors: trigger a graceful restart attempt (up to 3 retries)
        console.warn('[Listener] non-auth error; requesting restart for', accKey);
        try { restartRequests.add(String(accKey)); } catch {}
        try { restartRequests.add(String(session_key)); } catch {}
        try { api.listener.stop(); } catch {}
      }
    });

    // Lắng nghe sự kiện WebSocket bị ngắt kết nối để thu thập code/reason chi tiết (global scope)
    api.listener.on('disconnected', async (code, reason) => {
      // Các mã thường gặp từ zca-js: 3000 (DuplicateConnection), 3003 (KickConnection)
      console.warn('[Listener] disconnected', accKey, 'code=', code, 'reason=', reason);
      // Always cleanup current handles and release lock, then schedule reconnect (unless explicitly stopped)
      const h = activeListeners.get(accKey);
      if (h?.lockRenewId) { try { clearInterval(h.lockRenewId); } catch {} }
      activeListeners.delete(accKey);
      try { await releaseLock(lockKey); } catch {}
      if (stopRequests.has(String(accKey))) { try { stopRequests.delete(String(accKey)); } catch {}; return; }
      if (restartRequests.has(String(accKey)) || restartRequests.has(String(session_key))) {
        // Part of an intentional restart; 'stop' handler will schedule reconnect
        return;
      }
      scheduleReconnect(accKey, sessionRow, 3000);
    });

    // Khi socket đóng hẳn: xử lý như stop, và nếu là Kick/Duplicate coi như mất phiên đăng nhập (global scope)
    api.listener.on('closed', async (code, reason) => {
      console.warn('[Listener] closed', accKey, 'code=', code, 'reason=', reason);
      const h = activeListeners.get(accKey);
      if (h?.lockRenewId) { try { clearInterval(h.lockRenewId); } catch {} }
      activeListeners.delete(accKey);
      try { await releaseLock(lockKey); } catch {}
      // Nếu có yêu cầu dừng chủ động, không làm gì thêm
      if (stopRequests.has(String(accKey))) {
        try { stopRequests.delete(String(accKey)); } catch {}
        return;
      }
      // Nếu đây là đóng do restart chủ động, để 'stop' handler lên lịch reconnect
      if (restartRequests.has(String(accKey)) || restartRequests.has(String(session_key))) {
        return;
      }
      // Mặc định: thử auto-reconnect tối đa 3 lần rồi mới deactivate
      scheduleReconnect(accKey, sessionRow, 3000);
    });

    api.listener.start();

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
    }, 5000); // renew every 20s (less than TTL)

    activeListeners.set(accKey, { api, stop: () => api.listener.stop(), session_key, lockRenewId: lockRenewInterval });
    // Reset reconnect state on successful start
    try { reconnectAttempts.delete(String(accKey)); } catch {}
    try { reconnectAttempts.delete(String(session_key)); } catch {}
    try { restartRequests.delete(String(accKey)); } catch {}
    try { restartRequests.delete(String(session_key)); } catch {}
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
    // Clear timers
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
