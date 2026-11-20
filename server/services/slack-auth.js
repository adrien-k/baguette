/** Request signing and expiring tokens for the Slack integration. */
import crypto from 'crypto';
import { encrypt, decrypt } from '../lib/encrypt.js';

const SIGNATURE_MAX_AGE_SECONDS = 60 * 5;
const TOKEN_TTL_MS = 1000 * 60 * 30;

/**
 * Cheap shape checks on the signature headers, so junk is rejected before any database work:
 * a numeric timestamp within the allowed window and a `v0=<64 hex>` signature.
 */
export function looksLikeSlackSignature({ timestamp, signature, nowMs }) {
  if (!/^\d{1,12}$/.test(String(timestamp ?? ''))) return false;
  const age = Math.abs((nowMs ?? Date.now()) / 1000 - Number(timestamp));
  if (age > SIGNATURE_MAX_AGE_SECONDS) return false;
  return /^v0=[0-9a-f]{64}$/.test(String(signature ?? ''));
}

/** Verifies Slack's `X-Slack-Signature` over the raw request body (HTTP Events API only). */
export function verifySlackSignature({ signingSecret, timestamp, signature, rawBody, nowMs }) {
  if (!signingSecret || !timestamp || !signature || !rawBody) return false;
  const age = Math.abs((nowMs ?? Date.now()) / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_MAX_AGE_SECONDS) return false;
  const expected = `v0=${crypto
    .createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Opaque URL-safe token (OAuth state, account-link) that expires after 30 minutes. */
export function signSlackToken(payload) {
  const raw = encrypt(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  return Buffer.from(raw).toString('base64url');
}

/** The payload of a token from `signSlackToken`, or null if it is invalid or expired. */
export function readSlackToken(token) {
  try {
    const parsed = JSON.parse(decrypt(Buffer.from(String(token), 'base64url').toString()));
    if (!parsed?.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
