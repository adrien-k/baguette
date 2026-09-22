/**
 * Tests for the GitHub sign-in routes. GitHub access is always GitHub App based: the authorize
 * redirect requests no scope, and the install redirect / install callback manage which repos the
 * App may touch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { sign } from 'cookie-signature';
import { createTestDb } from '../../test-utils/db.js';

const COOKIE_SECRET = 'test-cookie-secret';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const configMock = vi.hoisted(() => ({ slug: null }));
vi.mock('../../config.js', () => ({
  AUTH_GITHUB_CLIENT_ID: 'client-id',
  AUTH_GITHUB_CLIENT_SECRET: 'client-secret',
  PUBLIC_HOST: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:3000',
  get GITHUB_APP_INSTALL_URL() {
    return configMock.slug ? `https://github.com/apps/${configMock.slug}/installations/new` : null;
  },
}));

const dbMock = vi.hoisted(() => ({ current: null }));
vi.mock('../../db.js', () => ({ default: (table) => dbMock.current(table) }));

vi.mock('../../services/preview.js', () => ({
  signProxyToken: vi.fn(() => 'proxy-token'),
  buildSessionHostname: vi.fn((hostname, service) => `${service}.${hostname}`),
}));

vi.mock('../../services/github.js', () => ({
  cacheScopeForUser: vi.fn((user) => `u${user?.id}`),
  clearReposCache: vi.fn(),
  clearInstallationsCache: vi.fn(),
}));

import { createAuthRoutes } from '../auth.js';
import {
  cacheScopeForUser,
  clearReposCache,
  clearInstallationsCache,
} from '../../services/github.js';

const db = createTestDb({ beforeEach, afterEach });

let server;
let baseUrl;

beforeEach(async () => {
  vi.clearAllMocks();
  configMock.slug = 'baguette-test';
  dbMock.current = db;

  const app = express();
  app.use(cookieParser(COOKIE_SECRET));
  app.use(createAuthRoutes({ service: () => ({}) }));

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** GET without following redirects, so the Location header can be asserted. */
function get(path, { cookie } = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
}

const signedUserCookie = (userId) => `userId=s%3A${sign(String(userId), COOKIE_SECRET)}`;

describe('GET /auth/github', () => {
  it('omits scope — a GitHub App uses its registered permissions instead', async () => {
    const res = await get('/auth/github');

    const location = new URL(res.headers.get('location'));
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.has('scope')).toBe(false);
    expect(location.searchParams.get('client_id')).toBe('client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/auth/github/callback'
    );
  });

  it('stores a local redirectTo and ignores an external one', async () => {
    const local = await get('/auth/github?redirectTo=%2Fsessions%2F1');
    expect(local.headers.get('set-cookie')).toContain('auth_redirect=%2Fsessions%2F1');

    const external = await get('/auth/github?redirectTo=https%3A%2F%2Fevil.example.com');
    expect(external.headers.get('set-cookie')).toBeNull();
  });
});

describe('GET /auth/github/install', () => {
  it('redirects to the App installation page', async () => {
    const res = await get('/auth/github/install');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://github.com/apps/baguette-test/installations/new'
    );
  });

  it('is unavailable when AUTH_GITHUB_APP_SLUG is unset', async () => {
    configMock.slug = null;

    const res = await get('/auth/github/install');
    expect(res.status).toBe(503);
  });
});

describe('GET /auth/github/callback', () => {
  it('clears cached repo lists and re-authorizes on a code-less post-install return', async () => {
    const [userId] = await db('users').insert({ github_id: 5, username: 'alice', approved: true });

    const res = await get('/auth/github/callback?installation_id=42&setup_action=install', {
      cookie: `${signedUserCookie(userId)}; auth_redirect=%2Fsettings`,
    });

    expect(cacheScopeForUser).toHaveBeenCalledWith({ id: String(userId) });
    expect(clearReposCache).toHaveBeenCalledWith(`u${userId}`);
    expect(clearInstallationsCache).toHaveBeenCalledWith(`u${userId}`);
    // No code to exchange means the stored token may predate the App, so mint a fresh one.
    expect(res.headers.get('location')).toBe('/auth/github');
    // auth_redirect must survive the detour so the user still lands on /settings.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  // Guards against a redirect loop: the authorize hop returns with a code and without
  // installation_id, so it must take the token-exchange path, not the re-authorize branch.
  it('does not re-authorize again once the authorize hop returns with a code', async () => {
    const [userId] = await db('users').insert({ github_id: 5, username: 'alice', approved: true });
    // Fail the token exchange so the handler stops before any GitHub user lookup; all this test
    // needs is proof that the re-authorize branch was not taken again. Only the GitHub call is
    // stubbed — `get` below goes through the same global fetch to reach the test server.
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((url, opts) =>
        String(url).startsWith(GITHUB_TOKEN_URL)
          ? Promise.resolve({ json: async () => ({ error: 'bad_verification_code' }) })
          : realFetch(url, opts)
      );

    try {
      const res = await get('/auth/github/callback?code=abc123', {
        cookie: signedUserCookie(userId),
      });

      expect(res.headers.get('location')).not.toBe('/auth/github');
      expect(res.status).toBe(400); // reached the exchange, not the redirect branch
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does not require a signed-in user to return from an install', async () => {
    const res = await get('/auth/github/callback?setup_action=install');

    expect(res.headers.get('location')).toBe('/');
    expect(clearReposCache).not.toHaveBeenCalled();
  });

  it('rejects a callback with neither a code nor an install result', async () => {
    const res = await get('/auth/github/callback');
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('reports the install URL when signed out', async () => {
    const res = await get('/auth/me');

    expect(await res.json()).toEqual({
      user: null,
      github: { install_url: 'https://github.com/apps/baguette-test/installations/new' },
    });
  });

  it('reports a null install URL when AUTH_GITHUB_APP_SLUG is unset', async () => {
    configMock.slug = null;

    const res = await get('/auth/me');

    const body = await res.json();
    expect(body.github).toEqual({ install_url: null });
  });

  it('includes the signed-in user alongside the github block', async () => {
    const [userId] = await db('users').insert({ github_id: 5, username: 'alice', approved: true });

    const res = await get('/auth/me', { cookie: signedUserCookie(userId) });

    const body = await res.json();
    expect(body.user).toMatchObject({ id: userId, username: 'alice', approved: true });
    expect(body.github.install_url).toBe('https://github.com/apps/baguette-test/installations/new');
  });
});
