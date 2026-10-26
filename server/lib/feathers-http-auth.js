import { parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import { ENCRYPTION_KEY } from '../config.js';

function readSignedUserId(cookies, secret) {
  const value = cookies.userId;
  if (!value || !value.startsWith('s:')) return null;
  const unsigned = unsign(value.slice(2), secret);
  return unsigned === false ? null : unsigned;
}

function normalizeIp(ip) {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

/** Client IP from a Web Fetch API Headers object (Feathers HTTP handler). */
export function getClientIpFromHeaders(headers) {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return normalizeIp(first);
  }
  return '';
}

/**
 * Feathers HTTP middleware: signed userId cookie → params.user (approved users only).
 */
export function createFeathersCookieAuth(feathersApp) {
  return async (context, next) => {
    const headerIp = getClientIpFromHeaders(context.request.headers);
    context.params = {
      ...context.params,
      clientIp: context.params.clientIp || headerIp,
    };

    if (context.params.user?.approved) {
      return next();
    }

    const cookieHeader = context.request.headers.get('cookie') || '';
    const cookies = parseCookie(cookieHeader);
    const userId = readSignedUserId(cookies, ENCRYPTION_KEY);
    if (!userId) {
      return next();
    }

    try {
      const user = await feathersApp.service('users').get(userId, {});
      if (user?.approved) {
        context.params.user = user;
      }
    } catch {
      // ignore invalid session cookie
    }

    return next();
  };
}
