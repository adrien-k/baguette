import { describe, it, expect, vi } from 'vitest';
import { cookieAuthMiddleware } from '../feathers.js';

/**
 * The shared cookie middleware classifies a signed session cookie into exactly one of
 * req.user (approved — full access) or req.pendingUser (signed in, unapproved — pending
 * page only). req.feathers.user must mirror req.user so the Feathers layer never sees a
 * pending identity.
 */
describe('cookieAuthMiddleware', () => {
  function feathersAppWith(user) {
    return {
      service: () => ({
        get: vi.fn(() => (user ? Promise.resolve(user) : Promise.reject(notFound()))),
      }),
    };
  }

  function notFound() {
    const err = new Error('Not found');
    err.code = 404;
    err.name = 'NotFound';
    return err;
  }

  function run(app, userId) {
    const req = { signedCookies: userId != null ? { userId: String(userId) } : {}, headers: {} };
    const next = vi.fn();
    return cookieAuthMiddleware(app)(req, {}, next).then(() => ({ req, next }));
  }

  it('sets req.user and req.feathers.user for an approved user', async () => {
    const user = { id: 7, approved: 1 };
    const { req, next } = await run(feathersAppWith(user), 7);

    expect(req.user).toBe(user);
    expect(req.feathers.user).toBe(user);
    expect(req.pendingUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets only req.pendingUser for an unapproved user (no req.user, no req.feathers.user)', async () => {
    const pending = { id: 8, approved: 0 };
    const { req, next } = await run(feathersAppWith(pending), 8);

    expect(req.pendingUser).toBe(pending);
    expect(req.user).toBeUndefined();
    expect(req.feathers.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets neither identity for a deleted user (stale cookie) and records the 404', async () => {
    const { req, next } = await run(feathersAppWith(null), 99);

    expect(req.user).toBeUndefined();
    expect(req.pendingUser).toBeUndefined();
    expect(req.feathers.user).toBeUndefined();
    expect(req.identityLookupError).toBeInstanceOf(Error);
    expect(req.identityLookupError.code).toBe(404);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('records a transient lookup error without granting any identity', async () => {
    const boom = new Error('db is down');
    const app = {
      service: () => ({
        get: vi.fn(() => Promise.reject(boom)),
      }),
    };
    const { req, next } = await run(app, 7);

    expect(req.user).toBeUndefined();
    expect(req.pendingUser).toBeUndefined();
    expect(req.identityLookupError).toBe(boom);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets neither identity without a cookie (anonymous)', async () => {
    const { req, next } = await run(feathersAppWith({ id: 1, approved: 1 }), null);

    expect(req.user).toBeUndefined();
    expect(req.pendingUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
