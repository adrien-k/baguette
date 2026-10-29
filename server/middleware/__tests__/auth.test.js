import { describe, it, expect } from 'vitest';
import { createRequireAuth } from '../auth.js';

/**
 * requireAuth guards API routes that must never be reachable by a pending account:
 * req.pendingUser → 403 (pending page only), req.user (approved) → next, otherwise
 * anonymous or stale-cookie handling.
 */
describe('requireAuth', () => {
  const requireAuth = createRequireAuth();

  function run(req) {
    const res = {
      statusCode: null,
      body: null,
      clearedCookie: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
      clearCookie() {
        this.clearedCookie = true;
      },
    };
    let nexted = false;
    let nextError;
    requireAuth(req, res, (...args) => {
      nexted = true;
      nextError = args[0];
    });
    return { nexted, nextError, res };
  }

  it('lets an approved req.user through', () => {
    const { nexted, res } = run({ user: { id: 1, approved: true }, signedCookies: {} });

    expect(nexted).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('rejects a pending user with 403 and never calls next', () => {
    const { nexted, res } = run({ pendingUser: { id: 2, approved: false }, signedCookies: {} });

    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account pending approval' });
  });

  it('rejects anonymous requests with 401', () => {
    const { nexted, res } = run({ signedCookies: {} });

    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Not authenticated' });
    expect(res.clearedCookie).toBe(false);
  });

  it('clears a stale cookie (identity unresolved) and answers 401 user not found', () => {
    const { nexted, res } = run({ signedCookies: { userId: '42' } });

    expect(nexted).toBe(false);
    expect(res.clearedCookie).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'User not found' });
  });

  it('forwards a transient lookup error (500 path) without clearing the session cookie', () => {
    const boom = new Error('db is down');
    const { nexted, nextError, res } = run({
      identityLookupError: boom,
      signedCookies: { userId: '42' },
    });

    expect(nexted).toBe(true);
    expect(nextError).toBe(boom);
    expect(res.clearedCookie).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});
