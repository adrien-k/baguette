import geoip from 'geoip-country';

const DEBOUNCE_MS = 5 * 60 * 1000;

const EDGE_COUNTRY_HEADERS = ['cf-ipcountry', 'cloudfront-viewer-country', 'x-appengine-country'];

function trustEdgeCountryHeaders() {
  const raw = process.env.TRUST_EDGE_COUNTRY;
  if (raw == null || raw === '') return false;
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'no';
}

function normalizeCountryCode(raw) {
  if (raw == null || raw === '') return null;
  const code = String(raw).trim().toUpperCase();
  if (code === 'XX' || code === 'T1') return null;
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code;
}

/** @param {import('express').Request | { headers?: Record<string, string | string[] | undefined> } | undefined} req */
export function countryFromEdgeHeaders(req) {
  const headers = req?.headers;
  if (!headers) return null;
  for (const name of EDGE_COUNTRY_HEADERS) {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    if (raw == null) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const code = normalizeCountryCode(value);
    if (code) return code;
  }
  return null;
}

export function isPrivateOrLoopbackIp(ip) {
  if (!ip) return true;
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (normalized === '::1') return true;
  if (normalized.includes(':')) {
    const lower = normalized.toLowerCase();
    if (lower.startsWith('fe80:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    return false;
  }
  const parts = normalized.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function countryFromIpLookup(ip) {
  if (!ip || isPrivateOrLoopbackIp(ip)) return null;
  const hit = geoip.lookup(ip);
  return normalizeCountryCode(hit?.country);
}

/** @param {import('express').Request | undefined} req */
export function resolveUserCountry(ip, req) {
  if (trustEdgeCountryHeaders()) {
    const fromHeader = countryFromEdgeHeaders(req);
    if (fromHeader) return fromHeader;
  }
  return countryFromIpLookup(ip);
}

function parseLastSeenMs(value) {
  if (value == null) return null;
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker; parse it as UTC, not local time.
  const text = String(value);
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text);
  const ms = new Date(hasZone ? text : `${text.replace(' ', 'T')}Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Updates users.last_ip / last_ip_country / last_seen_at.
 * @returns {Promise<boolean>} true if a row was updated
 */
export async function touchUserLastIp(db, userId, ip, req, { force = false } = {}) {
  if (!userId || !ip) return false;

  const country = resolveUserCountry(ip, req);

  if (!force) {
    const row = await db('users').where({ id: userId }).select('last_ip', 'last_seen_at').first();
    if (row?.last_ip === ip) {
      const lastMs = parseLastSeenMs(row.last_seen_at);
      if (lastMs != null && Date.now() - lastMs < DEBOUNCE_MS) {
        return false;
      }
    }
  }

  await db('users').where({ id: userId }).update({
    last_ip: ip,
    last_ip_country: country,
    last_seen_at: db.fn.now(),
  });
  return true;
}
