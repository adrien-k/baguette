import { parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import { ENCRYPTION_KEY } from '../config.js';
import { clientIpFrom } from './client-ip.js';

function readSignedUserId(cookies, secret) {
  const value = cookies.userId;
  if (!value || !value.startsWith('s:')) return null;
  const unsigned = unsign(value.slice(2), secret);
  return unsigned === false ? null : unsigned;
}

/** Client IP from a Web Fetch API Headers object (Feathers HTTP handler). */
export function getClientIpFromHeaders(headers) {
  return clientIpFrom(headers.get('x-forwarded-for'), '');
}

/**
 * Feathers HTTP middleware: signed userId cookie → params.user (approved users only).
 * A signed-in but unapproved identity is surfaced as params.pendingUser and never as
 * params.user, so service hooks (requireUser etc.) treat pending accounts as
 * unauthenticated — mirroring the Express req.user / req.pendingUser split.
 */
export function createFeathersCookieAuth(feathersApp) {
  return async (context, next) => {
    const headerIp = getClientIpFromHeaders(context.request.headers);
    context.params = {
      ...context.params,
      clientIp: context.params.clientIp || headerIp,
    };

    // Defensive: an unapproved identity handed in via params must be demoted before any
    // service hook can mistake it for an authenticated user.
    if (context.params.user && !context.params.user.approved) {
      context.params.pendingUser = context.params.user;
      delete context.params.user;
    }
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
      } else if (user) {
        context.params.pendingUser = user;
      }
    } catch {
      // ignore invalid session cookie
    }

    return next();
  };
}
