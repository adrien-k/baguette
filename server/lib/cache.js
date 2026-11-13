import fs from 'fs';
import path from 'path';
import { CACHE_DIR } from '../config.js';

/**
 * Sanitize cache key for use as filename (alphanumeric, dash, underscore only).
 */
function sanitizeKey(key) {
  return (
    key
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'cache'
  );
}

/**
 * Get cached value if file exists and is within TTL (based on file mtime).
 * @param {string} cacheKey - Cache key (used as filename under cache dir)
 * @param {number} ttlSeconds - TTL in seconds
 * @returns {Promise<unknown | null>} Parsed value or null if miss or expired
 */
export async function get(cacheKey, ttlSeconds) {
  const cachePath = path.join(CACHE_DIR, sanitizeKey(cacheKey));
  try {
    const stat = await fs.promises.stat(cachePath);
    const ageSeconds = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSeconds > ttlSeconds) return null;
    const raw = await fs.promises.readFile(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write value to cache file (JSON). Creates cache dir if needed.
 */
async function set(cacheKey, value) {
  const dir = CACHE_DIR;
  await fs.promises.mkdir(dir, { recursive: true });
  const cachePath = path.join(dir, sanitizeKey(cacheKey));
  await fs.promises.writeFile(cachePath, JSON.stringify(value), 'utf8');
}

const inFlight = new Map(); // cacheKey → Promise

/**
 * Fetch value: return cached if within TTL, else call actualFetch(), store and return result.
 * Concurrent calls with the same key share a single in-flight request.
 * actualFetch() may return any JSON-serializable value.
 * @param {string} cacheKey - Cache key
 * @param {number} ttlSeconds - TTL in seconds
 * @param {() => Promise<unknown>} actualFetch - Async function that returns the value to cache
 * @returns {Promise<unknown>}
 */
export async function fetch(cacheKey, ttlSeconds, actualFetch) {
  const cached = await get(cacheKey, ttlSeconds);
  if (cached !== null) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const value = await actualFetch();
    await set(cacheKey, value);
    return value;
  })();

  inFlight.set(cacheKey, promise);
  // `.finally()` chains a second promise that would flip any failure of the
  // first — even one already handled by the consumer above — into an unhandled
  // rejection. The `.catch()` detaches it safely without affecting the value
  // returned to callers.
  promise.finally(() => inFlight.delete(cacheKey)).catch(() => {});
  return promise;
}

export async function clear(cacheKey) {
  const p = path.join(CACHE_DIR, sanitizeKey(cacheKey));
  try {
    await fs.promises.unlink(p);
  } catch {
    /* missing cache file */
  }
  inFlight.delete(cacheKey);
}

export async function clearByPrefix(prefix) {
  const sanitized = sanitizeKey(prefix);
  let files;
  try {
    files = await fs.promises.readdir(CACHE_DIR);
  } catch {
    return;
  }
  await Promise.all(
    files
      .filter((f) => f.startsWith(sanitized))
      .map((f) => fs.promises.unlink(path.join(CACHE_DIR, f)).catch(() => {}))
  );
  for (const key of inFlight.keys()) {
    if (sanitizeKey(key).startsWith(sanitized)) inFlight.delete(key);
  }
}
