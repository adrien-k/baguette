import crypto from 'crypto';
import { PUBLIC_HOST } from '../config.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_TOKEN_PREFIX = 'bginv_';

export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function generateInviteToken() {
  return `${INVITE_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

export function inviteUrlForToken(token) {
  return `${PUBLIC_HOST.replace(/\/$/, '')}/invite/${encodeURIComponent(token)}`;
}

export function inviteExpiresAt(now = Date.now()) {
  return new Date(now + INVITE_TTL_MS).toISOString();
}

export function isInviteExpired(user, now = Date.now()) {
  if (!user?.invite_expires_at) return false;
  const expires = new Date(user.invite_expires_at).getTime();
  if (Number.isNaN(expires)) return false;
  return expires < now;
}
