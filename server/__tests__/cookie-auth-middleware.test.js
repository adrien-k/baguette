import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const touchChain = {
  where: vi.fn(function () {
    return touchChain;
  }),
  select: vi.fn(function () {
    return touchChain;
  }),
  first: vi.fn(async () => null),
  update: vi.fn(async () => 1),
};
vi.mock('../db.js', () => ({
  default: Object.assign(
    vi.fn(() => touchChain),
    {
      fn: { now: vi.fn(() => new Date().toISOString()) },
    }
  ),
}));

import { cookieAuthMiddleware } from '../feathers.js';
import logger from '../logger.js';

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
    const req = {
      signedCookies: userId != null ? { userId: String(userId) } : {},
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = { clearCookie: vi.fn() };
    const next = vi.fn();
    return cookieAuthMiddleware(app)(req, res, next).then(() => ({ req, res, next }));
  }

  it('sets req.user and req.feathers.user for an approved user', async () => {
    const user = { id: 7, status: 'approved' };
    const { req, next } = await run(feathersAppWith(user), 7);

    expect(req.user).toBe(user);
    expect(req.feathers.user).toBe(user);
    expect(req.pendingUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets only req.pendingUser for an unapproved user (no req.user, no req.feathers.user)', async () => {
    const pending = { id: 8, status: 'pending' };
    const { req, next } = await run(feathersAppWith(pending), 8);

    expect(req.pendingUser).toBe(pending);
    expect(req.user).toBeUndefined();
    expect(req.feathers.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('treats a deleted user as anonymous, clears the stale cookie, and does not warn', async () => {
    logger.warn.mockClear();
    const { req, res, next } = await run(feathersAppWith(null), 99);

    expect(req.user).toBeUndefined();
    expect(req.pendingUser).toBeUndefined();
    expect(req.feathers.user).toBeUndefined();
    expect(req.identityLookupError).toBeUndefined();
    expect(res.clearCookie).toHaveBeenCalledWith('userId');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('records a transient lookup error without granting any identity', async () => {
    const boom = new Error('db is down');
    const app = {
      service: () => ({
        get: vi.fn(() => Promise.reject(boom)),
      }),
    };
    logger.warn.mockClear();
    const { req, res, next } = await run(app, 7);

    expect(req.user).toBeUndefined();
    expect(req.pendingUser).toBeUndefined();
    expect(req.identityLookupError).toBe(boom);
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets neither identity without a cookie (anonymous)', async () => {
    const { req, next } = await run(feathersAppWith({ id: 1, status: 'approved' }), null);

    expect(req.user).toBeUndefined();
    expect(req.pendingUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
