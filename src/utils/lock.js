// Simple in-process lock. Replace with Redis for multi-instance.
const locks = new Map();

export async function acquireLock(key, ttlSeconds = 30) {
  if (locks.has(key)) return false;
  locks.set(key, setTimeout(() => locks.delete(key), ttlSeconds * 1000));
  return true;
}

export async function releaseLock(key) {
  const t = locks.get(key);
  if (t) clearTimeout(t);
  locks.delete(key);
}

export default { acquireLock, releaseLock };
