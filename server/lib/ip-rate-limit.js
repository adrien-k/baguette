/**
 * In-memory per-IP attempt window. Expired buckets are swept on use so the
 * map cannot grow without bound from distinct source addresses.
 */
export function createIpRateLimiter({ windowMs, maxAttempts, maxKeys = 10_000 } = {}) {
  const buckets = new Map();
  let lastPruneAt = 0;

  function prune(now) {
    const due = now - lastPruneAt >= windowMs || buckets.size >= maxKeys;
    if (!due) return;
    lastPruneAt = now;
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart > windowMs) buckets.delete(key);
    }
  }

  function cap() {
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      buckets.delete(oldest);
    }
  }

  function bucketFor(ip, now = Date.now()) {
    prune(now);
    const key = ip || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      bucket = { windowStart: now, attempts: 0 };
      buckets.set(key, bucket);
    }
    cap();
    return buckets.get(key) ?? bucket;
  }

  return {
    isLimited(ip, now = Date.now()) {
      return bucketFor(ip, now).attempts >= maxAttempts;
    },
    record(ip, now = Date.now()) {
      bucketFor(ip, now).attempts += 1;
    },
    get size() {
      return buckets.size;
    },
  };
}
