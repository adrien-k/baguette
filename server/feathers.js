import { feathers } from '@feathersjs/feathers';
import express from '@feathersjs/express';
/**
 * Cookie-based auth: set req.user and req.feathers.user for REST.
 * Uses signed userId cookie. Fetches the user via the Feathers service so hooks run.
 */
export function cookieAuthMiddleware(app) {
  return async (req, res, next) => {
    const userId = req.signedCookies?.userId;
    req.feathers = req.feathers || {};
    if (!userId) return next();
    try {
      const user = await app.service('users').get(userId, {});
      if (!user?.approved) return next();
      req.user = user;
      req.feathers.user = user;
      next();
    } catch {
      next();
    }
  };
}

/** Create the Feathers app (Express-compatible). */
export function createFeathersApp() {
  return express(feathers());
}
