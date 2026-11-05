import { feathers } from 'feathers';
import db from './db.js';
import { getClientIp } from './lib/client-ip.js';
import { touchUserLastIp } from './lib/user-last-ip.js';
import { requirePublicService } from './services/feathers/public-services.js';
import logger from './logger.js';

function isNotFoundError(err) {
  return Number(err?.code) === 404 || err?.name === 'NotFound' || err?.className === 'not-found';
}

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
      if (!user) {
        res.clearCookie('userId');
        return next();
      }
      if (!user.approved) {
        req.pendingUser = user;
        return next();
      }
      req.user = user;
      req.feathers.user = user;
      touchUserLastIp(db, user.id, req.feathers.clientIp, req).catch((err) => {
        logger.warn({ err, userId: user.id }, 'Failed to update user last IP');
      });
      next();
    } catch (err) {
      // Deleted / never-existed user (stale cookie after a DB wipe): stay anonymous
      // and drop the cookie. Do not warn — this is expected on first load of a fresh
      // instance. Transient failures stay on req.identityLookupError so requireAuth
      // can keep the cookie and surface a 500 instead of signing the operator out.
      if (isNotFoundError(err)) {
        res.clearCookie('userId');
        return next();
      }
      req.identityLookupError = err;
      logger.warn({ err }, 'Session cookie user lookup failed');
      next();
    }
  };
}
