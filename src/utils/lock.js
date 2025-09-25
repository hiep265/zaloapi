/**
 * Tiện ích khóa đa tầng (multi-layer locking)
 * 
 * Mục đích: đảm bảo tại mọi thời điểm chỉ có 1 listener cho mỗi tài khoản (account_id)
 * chạy trong toàn hệ thống (kể cả nhiều tiến trình hoặc nhiều máy).
 * 
 * Tầng khóa sử dụng (từ trong process ra ngoài cluster):
 * 1) Process-wide lock (Map trong bộ nhớ) — ngăn trùng trong cùng 1 tiến trình Node.js
 * 2) PostgreSQL advisory lock — ngăn trùng ở cấp cơ sở dữ liệu (nhiều tiến trình dùng chung DB)
 * 3) Redis distributed lock (nếu cấu hình) — ngăn trùng giữa nhiều máy/tiến trình với TTL, ownership token
 * 
 * Dòng chảy khi acquireLock(key, ttl):
 * - Thử lấy Redis lock (SET NX EX ttl). Nếu thất bại => đã có nơi khác giữ => trả về false.
 * - Thử lấy Postgres advisory lock: nếu thất bại => nhả Redis (nếu đã giữ) và trả về false.
 * - Ghi dấu process lock và đặt timer để tự release sau ttl (phòng khi quên release).
 * 
 * renewLock(key, ttl):
 * - Reset lại process timer và gia hạn TTL Redis (nếu đang giữ đúng token) bằng Lua script.
 * 
 * releaseLock(key):
 * - Tháo process timer, gọi pg_advisory_unlock, và nhả Redis bằng Lua (chỉ khi còn giữ đúng token).
 */

import crypto from 'crypto';
import db from '../db/index.js';

let redisClient = null;
let hasTriedInitRedis = false;

async function initRedisIfNeeded() {
  if (hasTriedInitRedis || redisClient) return redisClient;
  hasTriedInitRedis = true;
  try {
    const { createClient } = await import('redis');
    // Prefer REDIS_URL, else host/port
    const url = process.env.REDIS_URL || null;
    const conf = url ? { url } : {
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT || 6379),
      },
      password: process.env.REDIS_PASSWORD || undefined,
      database: process.env.REDIS_DB ? Number(process.env.REDIS_DB) : undefined,
    };
    const client = createClient(conf);
    client.on('error', (err) => {
      console.warn('[Lock] Redis error:', err?.message || err);
    });
    await client.connect();
    redisClient = client;
  } catch (e) {
    console.warn('[Lock] Redis not configured or failed to init. Falling back to process+DB locks only:', e?.message || e);
    redisClient = null;
  }
  return redisClient;
}

// Trạng thái khóa trong process: key -> { timer, redisToken, hasDbLock }
// - timer: hẹn giờ tự release sau TTL (phòng ngừa leak)
// - redisToken: chuỗi sở hữu (ownership) cho Redis lock; chỉ chủ sở hữu mới được nhả
// - hasDbLock: đã giữ advisory lock ở Postgres hay chưa
const processLocks = new Map();

function makeRedisKey(key) {
  return `zalo:listener:lock:${key}`;
}

function makeRedisToken() {
  return crypto.randomBytes(16).toString('hex');
}

async function tryAcquireDbAdvisory(key) {
  // Dùng biến thể 2-số int thông qua hashtext để tránh thao tác bigint ở JS
  // Trả về true nếu acquire thành công; false nếu đang bị nơi khác giữ
  const res = await db.query('SELECT pg_try_advisory_lock(hashtext($1)::int, 0) as ok', [key]);
  return !!res.rows?.[0]?.ok;
}

async function releaseDbAdvisory(key) {
  try {
    await db.query('SELECT pg_advisory_unlock(hashtext($1)::int, 0)', [key]);
  } catch (e) {
    console.warn('[Lock] releaseDbAdvisory failed:', e?.message || e);
  }
}

async function tryAcquireRedis(key, ttlSeconds) {
  const client = await initRedisIfNeeded();
  // Nếu không có Redis (chưa cấu hình) coi như bỏ qua tầng Redis và cho phép tiếp tục
  if (!client) return { ok: true, token: null, used: false };
  const rkey = makeRedisKey(key);
  const token = makeRedisToken();
  // Đặt khóa Redis với ownership token và TTL: chỉ tạo nếu chưa tồn tại (NX)
  const ok = await client.set(rkey, token, { NX: true, EX: ttlSeconds });
  return { ok: ok === 'OK', token, used: true };
}

async function releaseRedis(key, token) {
  const client = await initRedisIfNeeded();
  if (!client) return;
  const rkey = makeRedisKey(key);
  // Chỉ nhả khóa nếu vẫn còn sở hữu đúng token (tránh gỡ nhầm của người khác)
  const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
  try {
    await client.eval(script, { keys: [rkey], arguments: [token || ''] });
  } catch (e) {
    console.warn('[Lock] releaseRedis failed:', e?.message || e);
  }
}

export async function acquireLock(key, ttlSeconds = 5) {
  // Bước 1: chặn trùng trong cùng process
  if (processLocks.has(key)) {
    return false;
  }

  // Bước 2: khóa Redis (nếu có) để đảm bảo duy nhất ở cấp cụm (cluster)
  // Bước 3: khóa Postgres advisory — thêm lớp an toàn ở cấp DB
  // Bước 4: ghi dấu process lock và đặt timer tự release
  const redisRes = await tryAcquireRedis(key, ttlSeconds);
  if (!redisRes.ok) {
    return false;
  }
  const dbOk = await tryAcquireDbAdvisory(key);
  if (!dbOk) {
    // Nếu DB lock thất bại mà Redis lock đã giữ, cần nhả Redis để không giữ khóa mồ côi
    if (redisRes.used && redisRes.token) {
      await releaseRedis(key, redisRes.token);
    }
    return false;
  }

  // Đặt timer để tự động release sau TTL — hạn chế rủi ro lock bị “rò rỉ”
  const timer = setTimeout(async () => {
    try { await releaseDbAdvisory(key); } catch {}
    try { if (redisRes.used && redisRes.token) await releaseRedis(key, redisRes.token); } catch {}
    processLocks.delete(key);
  }, ttlSeconds * 1000);

  processLocks.set(key, { timer, redisToken: redisRes.token, hasDbLock: true });
  return true;
}

export async function releaseLock(key) {
  const st = processLocks.get(key);
  if (st?.timer) clearTimeout(st.timer);
  processLocks.delete(key);
  try { await releaseDbAdvisory(key); } catch {}
  try { if (st?.redisToken) await releaseRedis(key, st.redisToken); } catch {}
}

export async function renewLock(key, ttlSeconds = 5) {
  const st = processLocks.get(key);
  if (!st) return false;
  // Gia hạn timer trong process
  if (st.timer) clearTimeout(st.timer);
  st.timer = setTimeout(async () => {
    try { await releaseDbAdvisory(key); } catch {}
    try { if (st?.redisToken) await releaseRedis(key, st.redisToken); } catch {}
    processLocks.delete(key);
  }, ttlSeconds * 1000);
  processLocks.set(key, st);

  // Kéo dài TTL trong Redis chỉ khi vẫn còn sở hữu đúng token (ownership)
  if (st.redisToken) {
    try {
      const client = await initRedisIfNeeded();
      if (client) {
        const rkey = makeRedisKey(key);
        const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end`;
        await client.eval(script, { keys: [rkey], arguments: [st.redisToken, String(ttlSeconds)] });
      }
    } catch (e) {
      console.warn('[Lock] renewLock redis extend failed:', e?.message || e);
    }
  }
  return true;
}

export default { acquireLock, releaseLock, renewLock };
