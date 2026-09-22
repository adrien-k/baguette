/**
 * Tests for the GitHub sign-in routes, covering both auth modes:
 *
 * - oauth mode (no GITHUB_APP_SLUG): classic OAuth App, asks for the `repo` scope
 * - app mode: GitHub App, no scope requested, plus the install redirect and the install callback
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { sign } from 'cookie-signature';
import { createTestDb } from '../../test-utils/db.js';

const COOKIE_SECRET = 'test-cookie-secret';

const configMock = vi.hoisted(() => ({ slug: null }));
vi.mock('../../config.js', () => ({
  GITHUB_CLIENT_ID: 'client-id',
  GITHUB_CLIENT_SECRET: 'client-secret',
  PUBLIC_HOST: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:3000',
  get GITHUB_AUTH_MODE() {
    return configMock.slug ? 'app' : 'oauth';
  },
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
  clearOrgsCache: vi.fn(),
}));

import { createAuthRoutes } from '../auth.js';
import { cacheScopeForUser, clearReposCache, clearOrgsCache } from '../../services/github.js';

const db = createTestDb({ beforeEach, afterEach });

let server;
let baseUrl;

beforeEach(async () => {
  vi.clearAllMocks();
  configMock.slug = null;
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
  it('requests the repo scope in oauth mode', async () => {
    const res = await get('/auth/github');

    const location = new URL(res.headers.get('location'));
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('scope')).toBe('repo read:user user:email workflow');
    expect(location.searchParams.get('client_id')).toBe('client-id');
  });

  it('omits scope in app mode — a GitHub App uses its registered permissions instead', async () => {
    configMock.slug = 'baguette-test';

    const res = await get('/auth/github');

    const location = new URL(res.headers.get('location'));
    expect(location.searchParams.has('scope')).toBe(false);
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
  it('redirects to the App installation page in app mode', async () => {
    configMock.slug = 'baguette-test';

    const res = await get('/auth/github/install');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://github.com/apps/baguette-test/installations/new'
    );
  });

  it('is unavailable when no GitHub App is configured', async () => {
    const res = await get('/auth/github/install');
    expect(res.status).toBe(503);
  });
});

describe('GET /auth/github/callback', () => {
  it('handles the post-install return by clearing cached repo lists', async () => {
    configMock.slug = 'baguette-test';
    const [userId] = await db('users').insert({ github_id: 5, username: 'alice', approved: true });

    const res = await get('/auth/github/callback?installation_id=42&setup_action=install', {
      cookie: `${signedUserCookie(userId)}; auth_redirect=%2Fsettings`,
    });

    expect(cacheScopeForUser).toHaveBeenCalledWith({ id: String(userId) });
    expect(clearReposCache).toHaveBeenCalledWith(`u${userId}`);
    expect(clearOrgsCache).toHaveBeenCalledWith(`u${userId}`);
    expect(res.headers.get('location')).toBe('/settings');
  });

  it('does not require a signed-in user to return from an install', async () => {
    configMock.slug = 'baguette-test';

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
  it('reports the auth mode and install URL when signed out', async () => {
    configMock.slug = 'baguette-test';

    const res = await get('/auth/me');

    expect(await res.json()).toEqual({
      user: null,
      github: {
        auth_mode: 'app',
        install_url: 'https://github.com/apps/baguette-test/installations/new',
      },
    });
  });

  it('reports oauth mode with no install URL when no App is configured', async () => {
    const res = await get('/auth/me');

    const body = await res.json();
    expect(body.github).toEqual({ auth_mode: 'oauth', install_url: null });
  });

  it('includes the signed-in user alongside the github block', async () => {
    const [userId] = await db('users').insert({ github_id: 5, username: 'alice', approved: true });

    const res = await get('/auth/me', { cookie: signedUserCookie(userId) });

    const body = await res.json();
    expect(body.user).toMatchObject({ id: userId, username: 'alice', approved: true });
    expect(body.github.auth_mode).toBe('oauth');
  });
});
