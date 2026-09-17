import crypto from 'crypto';
import { ENCRYPTION_KEY, PUBLIC_API_URL } from '../config.js';

const TTL_MS = 5 * 60 * 1000; // 5 minutes

function _sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', ENCRYPTION_KEY).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function _verify(token) {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) throw new Error('Invalid token format');
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = crypto.createHmac('sha256', ENCRYPTION_KEY).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid signature');
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (Date.now() > payload.e) throw new Error('Token expired');
  return payload;
}

/** Signs a short-lived token containing the user ID for proxy authentication. */
export function signProxyToken(userId) {
  return _sign({ u: userId, e: Date.now() + TTL_MS });
}

/** Verifies a proxy token and returns the userId. */
export function verifyProxyToken(token) {
  return _verify(token).u;
}

const SESSION_PREFIX = 'session-';

export function buildSessionHostname(base, suffix) {
  return base.startsWith('www.') ? `${suffix}.${base.slice(4)}` : `${suffix}.${base}`;
}

/** Returns the preview subdomain URL for a session (portal or single-service). e.g. https://session-abc123.example.com/ */
export function getPreviewHost(shortId) {
  const url = new URL(PUBLIC_API_URL);
  url.hostname = buildSessionHostname(url.hostname, `${SESSION_PREFIX}${shortId}`);
  return url.toString();
}

/** Returns the preview subdomain URL for a named service. e.g. https://session-abc123-api.example.com/ */
export function getServicePreviewHost(shortId, serviceName) {
  const url = new URL(PUBLIC_API_URL);
  url.hostname = buildSessionHostname(url.hostname, `${SESSION_PREFIX}${shortId}-${serviceName}`);
  return url.toString();
}

/**
 * Extract session shortId (and optional service name) from a Host header.
 * Returns { shortId, serviceName } or null if not a session subdomain.
 * serviceName is null for the portal / single-service subdomain.
 */
export function extractSessionIdFromHost(host) {
  const match = host.match(new RegExp(`^${SESSION_PREFIX}([a-f0-9]{4,})(?:-([a-z0-9][a-z0-9-]*))?\\.`));
  if (!match) return null;
  return { shortId: match[1], serviceName: match[2] ?? null };
}
