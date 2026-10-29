import { feathers } from 'feathers';
import { getClientIp } from './lib/client-ip.js';
import { requirePublicService } from './services/feathers/public-services.js';
import logger from './logger.js';

/** Standalone Feathers v6 application (no Express wrapper). */
export function createFeathersApp() {
  const app = feathers();
  // Deny-by-default transport gate: external calls may only reach services listed in
  // PUBLIC_SERVICES. Per-service hooks still enforce auth and ownership scoping; this
  // catches services registered without them.
  app.hooks({ before: { all: [requirePublicService] } });
  return app;
}

/**
 * Express cookie auth: resolves the signed userId cookie into exactly one of
 *   req.user        — an existing, APPROVED user (full access),
 *   req.pendingUser — an existing but unapproved user (may only reach the pending page
 *                     and the auth plumbing; every API surface must reject it),
 *   neither         — anonymous (no cookie, unknown or deleted user).
 * req.feathers.user mirrors req.user so the Feathers layer never sees a pending identity.
 * Downstream code must trust these fields, not re-resolve the cookie itself.
 */
export function cookieAuthMiddleware(feathersApp) {
  return async (req, res, next) => {
    const userId = req.signedCookies?.userId;
    req.feathers = req.feathers || {};
    req.feathers.clientIp = getClientIp(req);
    if (!userId) return next();
    try {
      const user = await feathersApp.service('users').get(userId, {});
      if (!user) return next();
      if (!user.approved) {
        req.pendingUser = user;
        return next();
      }
      req.user = user;
      req.feathers.user = user;
      next();
    } catch (err) {
      // A failed lookup must stay distinguishable from "user deleted": requireAuth only
      // clears the session cookie on a definitive 404, not on transient errors.
      req.identityLookupError = err;
      logger.warn({ err }, 'Session cookie user lookup failed');
      next();
    }
  };
}
