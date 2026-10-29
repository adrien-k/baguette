import { TRUST_PROXY_HOPS } from '../config.js';

function normalizeIp(ip) {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

/**
 * Client IP for access control.
 *
 * X-Forwarded-For is read right-to-left: every proxy in front of Baguette appends the
 * address it saw, so only the rightmost `trustedHops` entries cannot be forged by the
 * client. With the default of one trusted hop (an edge proxy like kamal-proxy or Fly's
 * router), a client-supplied X-Forwarded-For value lands further left and is ignored.
 * Falls back to the socket address when no trusted forwarded entry exists.
 */
export function clientIpFrom(xffHeader, remoteAddress, trustedHops = TRUST_PROXY_HOPS) {
  const hops = xffHeader
    ? String(xffHeader)
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean)
    : [];
  const idx = hops.length - trustedHops;
  if (idx >= 0 && idx < hops.length) return normalizeIp(hops[idx]);
  return normalizeIp(remoteAddress || '');
}

export function getClientIp(req) {
  return clientIpFrom(req.headers?.['x-forwarded-for'], req.socket?.remoteAddress);
}
