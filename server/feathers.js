import { feathers } from 'feathers';
import { getClientIp } from './lib/client-ip.js';

/** Standalone Feathers v6 application (no Express wrapper). */
export function createFeathersApp() {
  return feathers();
}

/**
 * Express cookie auth: set req.user and req.feathers for non-Feathers routes.
 * Uses signed userId cookie. Fetches the user via the Feathers service so hooks run.
 */
export function cookieAuthMiddleware(feathersApp) {
  return async (req, res, next) => {
    const userId = req.signedCookies?.userId;
    req.feathers = req.feathers || {};
    req.feathers.clientIp = getClientIp(req);
    if (!userId) return next();
    try {
      const user = await feathersApp.service('users').get(userId, {});
      if (!user?.approved) return next();
      req.user = user;
      req.feathers.user = user;
      next();
    } catch {
      next();
    }
  };
}
