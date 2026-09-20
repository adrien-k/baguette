/** Client IP for access control (first X-Forwarded-For hop when present). */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return normalizeIp(first);
  }
  return normalizeIp(req.socket?.remoteAddress || '');
}

function normalizeIp(ip) {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}
