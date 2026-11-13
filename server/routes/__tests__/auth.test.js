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

const githubConfigMock = vi.hoisted(() => ({
  configured: true,
  client_id: 'client-id',
  client_secret: 'client-secret',
  slug: 'baguette-test',
  app_id: null,
  install_url: 'https://github.com/apps/baguette-test/installations/new',
}));

vi.mock('../../config.js', () => ({
  PUBLIC_HOST: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:3000',
  TRUST_PROXY_HOPS: 1,
  ENCRYPTION_KEY: 'test-encryption-key-at-least-32-chars',
}));

vi.mock('../../lib/instance-settings.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getGithubAppConfig: vi.fn(async () => ({ ...githubConfigMock })),
  };
});

const dbMock = vi.hoisted(() => ({ current: null }));
function dbFacade(table) {
  return dbMock.current(table);
}
dbFacade.transaction = (...args) => dbMock.current.transaction(...args);
dbFacade.raw = (...args) => dbMock.current.raw(...args);
dbFacade.fn = { now: (...args) => dbMock.current.fn.now(...args) };
vi.mock('../../db.js', () => ({ default: dbFacade }));

vi.mock('../../services/preview.js', () => ({
  signProxyToken: vi.fn(() => 'proxy-token'),
  buildSessionHostname: vi.fn((hostname, service) => `${service}.${hostname}`),
}));

vi.mock('../../services/github.js', () => ({
  cacheScopeForUser: vi.fn((user) => `u${user?.id}`),
  clearReposCache: vi.fn(),
  clearInstallationsCache: vi.fn(),
}));

const webauthnServerMock = vi.hoisted(() => ({
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...args) => webauthnServerMock.generateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args) => webauthnServerMock.verifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args) =>
    webauthnServerMock.generateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args) =>
    webauthnServerMock.verifyAuthenticationResponse(...args),
}));

import { createAuthRoutes } from '../auth.js';
import { generateInviteToken, hashInviteToken, inviteExpiresAt } from '../../lib/user-invite.js';
import { cookieAuthMiddleware } from '../../feathers.js';
import {
  cacheScopeForUser,
  clearReposCache,
  clearInstallationsCache,
} from '../../services/github.js';

const db = createTestDb();

let server;
let baseUrl;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  githubConfigMock.configured = true;
  githubConfigMock.client_id = 'client-id';
  githubConfigMock.client_secret = 'client-secret';
  githubConfigMock.slug = 'baguette-test';
  githubConfigMock.install_url = 'https://github.com/apps/baguette-test/installations/new';
  dbMock.current = db;

  webauthnServerMock.generateAuthenticationOptions.mockResolvedValue({
    challenge: 'login-challenge-b64',
    rpId: 'localhost',
  });
  webauthnServerMock.verifyAuthenticationResponse.mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  });
  webauthnServerMock.generateRegistrationOptions.mockResolvedValue({
    challenge: 'reg-challenge-b64',
    rp: { name: 'Baguette', id: 'localhost' },
  });
  webauthnServerMock.verifyRegistrationResponse.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      credential: {
        id: 'cred-id-b64',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal'],
      },
    },
  });

  const app = express();
  app.use(express.json());
  app.use(cookieParser(COOKIE_SECRET));
  // Mirror production: the shared cookie middleware resolves req.user / req.pendingUser
  // before the auth routes run; both read those fields instead of the raw cookie.
  app.set('view engine', 'ejs');
  app.set('views', new URL('../../views', import.meta.url).pathname);
  const fakeFeathersApp = { service: () => testUsersService() };
  app.use(cookieAuthMiddleware(fakeFeathersApp));
  app.use(createAuthRoutes(fakeFeathersApp));

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

function post(path, { body, cookie } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

const signedUserCookie = (userId) => `userId=s%3A${sign(String(userId), COOKIE_SECRET)}`;

function userIdFromSetCookie(setCookieHeader) {
  expect(setCookieHeader).toBeTruthy();
  const match = setCookieHeader.match(/userId=s%3A[^;]+/);
  expect(match).toBeTruthy();
  return match[0];
}

/** Users service stand-in backed by the same test DB (mirrors the Feathers users service). */
function testUsersService() {
  return {
    async get(id) {
      const user = await db('users')
        .where({ id: Number(id) })
        .first();
      if (!user) {
        const err = new Error('Not found');
        err.code = 404;
        err.name = 'NotFound';
        throw err;
      }
      return user;
    },
    async create(data, params = {}) {
      const trx = params.transaction?.trx ?? db;
      const insert = {
        github_id: data.github_id ?? null,
        username: data.username,
        avatar_url: data.avatar_url ?? null,
        email: data.email ?? null,
        admin: data.admin ? 1 : 0,
        onboarding_completed: data.onboarding_completed ? 1 : 0,
      };
      if (data.status !== undefined) insert.status = data.status;
      else if (data.approved !== undefined) insert.status = data.approved ? 'approved' : 'pending';
      if (data.access_token !== undefined) {
        insert.access_token_encrypted = data.access_token;
      }
      const [id] = await trx('users').insert(insert);
      return trx('users').where({ id }).first();
    },
    async patch(id, data, params = {}) {
      const trx = params.transaction?.trx ?? db;
      const patch = { ...data };
      if (patch.approved !== undefined) {
        patch.status = patch.approved ? 'approved' : 'pending';
        delete patch.approved;
      }
      if (patch.admin !== undefined) patch.admin = patch.admin ? 1 : 0;
      if (patch.onboarding_completed !== undefined) {
        patch.onboarding_completed = patch.onboarding_completed ? 1 : 0;
      }
      if (patch.access_token !== undefined) {
        patch.access_token_encrypted = patch.access_token;
        delete patch.access_token;
      }
      await trx('users')
        .where({ id: Number(id) })
        .update(patch);
      return trx('users')
        .where({ id: Number(id) })
        .first();
    },
  };
}

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

  it('returns 503 when the GitHub App is not configured', async () => {
    githubConfigMock.configured = false;

    const res = await get('/auth/github');
    expect(res.status).toBe(503);
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

  it('is unavailable when the App slug is unset', async () => {
    githubConfigMock.install_url = null;

    const res = await get('/auth/github/install');
    expect(res.status).toBe(503);
  });
});

describe('GET /auth/github/callback', () => {
  it('clears cached repo lists and re-authorizes on a code-less post-install return', async () => {
    const [userId] = await db('users').insert({
      github_id: 5,
      username: 'alice',
      status: 'approved',
    });

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
    const [userId] = await db('users').insert({
      github_id: 5,
      username: 'alice',
      status: 'approved',
    });
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

describe('GET /auth/proxy', () => {
  it('sends unauthenticated users to login with a return URL', async () => {
    const res = await get('/auth/proxy?service=my-session&redirectTo=%2Fpreview');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location'));
    expect(location.origin + location.pathname).toBe('http://localhost:5173/login');
    expect(location.searchParams.get('redirectTo')).toBe(
      '/auth/proxy?service=my-session&redirectTo=%2Fpreview'
    );
  });

  it('redirects signed-in users to the session auth URL with a safe redirectTo only', async () => {
    const [userId] = await db('users').insert({
      github_id: 5,
      username: 'alice',
      status: 'approved',
    });

    const safe = await get('/auth/proxy?service=sess&redirectTo=%2Ffoo%3Fq%3D1', {
      cookie: signedUserCookie(userId),
    });
    expect(safe.status).toBe(302);
    expect(safe.headers.get('location')).toBe(
      'http://sess.localhost/_baguette/auth?sign=proxy-token&redirectTo=%2Ffoo%3Fq%3D1'
    );

    const external = await get('/auth/proxy?service=sess&redirectTo=https%3A%2F%2Fevil.example', {
      cookie: signedUserCookie(userId),
    });
    expect(external.headers.get('location')).toBe(
      'http://sess.localhost/_baguette/auth?sign=proxy-token'
    );
  });

  it('rejects a pending (unapproved) account with a denial page and no proxy token', async () => {
    const [pendingId] = await db('users').insert({
      github_id: 9,
      username: 'pending',
      status: 'pending',
    });

    const res = await get('/auth/proxy?service=sess', { cookie: signedUserCookie(pendingId) });

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('pending approval');
  });

  it('rejects a revoked account with revoked copy and no proxy token', async () => {
    const [revokedId] = await db('users').insert({
      github_id: 10,
      username: 'revoked',
      status: 'revoked',
    });

    const res = await get('/auth/proxy?service=sess', { cookie: signedUserCookie(revokedId) });

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('access revoked');
  });

  it('sends a stale cookie (deleted user) to login and clears the cookie', async () => {
    const res = await get('/auth/proxy?service=sess', { cookie: signedUserCookie(99999) });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('http://localhost:5173/login');
    expect(res.headers.get('set-cookie')).toContain('userId=;');
  });
});

describe('GET /auth/me', () => {
  it('reports the install URL when signed out', async () => {
    const res = await get('/auth/me');

    expect(await res.json()).toEqual({
      user: null,
      github: {
        install_url: 'https://github.com/apps/baguette-test/installations/new',
        configured: true,
      },
      bootstrap: { available: true, password_required: false },
      passkeys: { available: false },
    });
  });

  it('reports a null install URL when the App slug is unset', async () => {
    githubConfigMock.install_url = null;

    const res = await get('/auth/me');

    const body = await res.json();
    expect(body.github).toEqual({ install_url: null, configured: true });
    expect(body.bootstrap).toEqual({ available: true, password_required: false });
    expect(body.passkeys).toEqual({ available: false });
  });

  it('reflects github.configured from instance settings', async () => {
    githubConfigMock.configured = false;

    const res = await get('/auth/me');
    const body = await res.json();
    expect(body.github.configured).toBe(false);
  });

  it('marks bootstrap unavailable after a user exists', async () => {
    await db('users').insert({ github_id: 1, username: 'only', status: 'approved' });

    const res = await get('/auth/me');
    const body = await res.json();
    expect(body.bootstrap).toEqual({ available: false, password_required: false });
    expect(body.passkeys).toEqual({ available: false });
  });

  it('reports passkeys.available when a passkey is registered', async () => {
    const [userId] = await db('users').insert({
      github_id: 1,
      username: 'with-passkey',
      status: 'approved',
    });
    await db('user_passkeys').insert({
      user_id: userId,
      credential_id: 'me-cred-1',
      public_key: 'AQID',
      counter: 0,
    });

    const res = await get('/auth/me');
    const body = await res.json();
    expect(body.passkeys).toEqual({ available: true });
  });

  it('includes the signed-in user alongside the github block', async () => {
    const [userId] = await db('users').insert({
      github_id: 5,
      username: 'alice',
      status: 'approved',
      admin: 1,
    });

    const res = await get('/auth/me', { cookie: signedUserCookie(userId) });

    const body = await res.json();
    expect(body.user).toMatchObject({
      id: userId,
      username: 'alice',
      status: 'approved',
      approved: true,
      admin: true,
      color_scheme: 'dark',
      github_linked: true,
      passkey_count: 0,
      is_first_user: true,
    });
    expect(body.user.last_ip).toBeUndefined();
    expect(body.user.last_seen_at).toBeUndefined();
    expect(body.user).not.toHaveProperty('ssh_private_key');
    expect(body.user).not.toHaveProperty('ssh_private_key_encrypted');
    expect(body.user).not.toHaveProperty('ssh_key_configured');
    expect(body.user).not.toHaveProperty('ssh_public_key');
    expect(body.github.install_url).toBe('https://github.com/apps/baguette-test/installations/new');
    expect(body.bootstrap).toEqual({ available: false, password_required: false });
    expect(body.passkeys).toEqual({ available: false });
  });

  it('reports a pending account with status pending (the pending page reads this)', async () => {
    const [pendingId] = await db('users').insert({
      github_id: 11,
      username: 'pendingme',
      status: 'pending',
      admin: 0,
    });

    const res = await get('/auth/me', { cookie: signedUserCookie(pendingId) });

    const body = await res.json();
    expect(body.user).toMatchObject({
      id: pendingId,
      username: 'pendingme',
      status: 'pending',
      approved: false,
    });
  });

  it('reports a revoked account with status revoked (the access-revoked page reads this)', async () => {
    const [revokedId] = await db('users').insert({
      github_id: 12,
      username: 'revokedme',
      status: 'revoked',
    });

    const res = await get('/auth/me', { cookie: signedUserCookie(revokedId) });

    const body = await res.json();
    expect(body.user).toMatchObject({
      id: revokedId,
      username: 'revokedme',
      status: 'revoked',
      approved: false,
    });
  });

  it('marks only the earliest user as is_first_user', async () => {
    const [firstId] = await db('users').insert({
      github_id: 1,
      username: 'first',
      status: 'approved',
      admin: 1,
    });
    const [laterId] = await db('users').insert({
      github_id: null,
      username: 'later',
      status: 'approved',
      admin: 0,
    });

    const firstRes = await get('/auth/me', { cookie: signedUserCookie(firstId) });
    expect((await firstRes.json()).user.is_first_user).toBe(true);

    const laterRes = await get('/auth/me', { cookie: signedUserCookie(laterId) });
    expect((await laterRes.json()).user.is_first_user).toBe(false);
  });

  it('reports password_required when BOOTSTRAP_PASSWORD is set', async () => {
    vi.stubEnv('BOOTSTRAP_PASSWORD', 'secret');

    const res = await get('/auth/me');
    const body = await res.json();
    expect(body.bootstrap.password_required).toBe(true);
  });
});

describe('GET /auth/github/manifest', () => {
  async function getJson(path, { cookie } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: cookie ? { cookie } : {},
    });
    return { res, body: res.ok ? await res.json() : null };
  }

  it('returns manifest payload for a signed-in admin', async () => {
    const [userId] = await db('users').insert({
      github_id: 50,
      username: 'admin',
      status: 'approved',
      admin: 1,
    });

    const { res, body } = await getJson('/auth/github/manifest', {
      cookie: signedUserCookie(userId),
    });

    expect(res.status).toBe(200);
    expect(body.github_form_url).toBe('https://github.com/settings/apps/new');
    expect(body.manifest.redirect_url).toBe('http://localhost:5173/auth/github/manifest/callback');
    expect(body.manifest.url).toMatch(/github_manifest_state=[0-9a-f]+/);
    expect(body.manifest.request_oauth_on_install).toBe(true);
    expect(body.manifest.hook_attributes).toBeUndefined();
    expect(res.headers.get('set-cookie')).toMatch(/github_manifest_state=[0-9a-f]+/);
  });

  it('uses org form URL when org query is a safe slug', async () => {
    const [userId] = await db('users').insert({
      github_id: 51,
      username: 'orgadmin',
      status: 'approved',
      admin: 1,
    });

    const { body } = await getJson('/auth/github/manifest?org=acme-corp', {
      cookie: signedUserCookie(userId),
    });

    expect(body.github_form_url).toBe(
      'https://github.com/organizations/acme-corp/settings/apps/new'
    );
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await get('/auth/github/manifest');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const [userId] = await db('users').insert({
      github_id: 52,
      username: 'member',
      status: 'approved',
      admin: 0,
    });

    const res = await get('/auth/github/manifest', { cookie: signedUserCookie(userId) });
    expect(res.status).toBe(403);
  });
});

describe('GET /auth/github/manifest/callback', () => {
  const CONVERSION_URL_PREFIX = 'https://api.github.com/app-manifests/';

  async function startManifest(userId) {
    const res = await fetch(`${baseUrl}/auth/github/manifest`, {
      headers: { cookie: signedUserCookie(userId) },
    });
    const body = await res.json();
    const state = new URL(body.manifest.url).searchParams.get('github_manifest_state');
    expect(state).toMatch(/^[0-9a-f]+$/);
    return {
      state,
      cookie: `${signedUserCookie(userId)}; github_manifest_state=${state}`,
      externalUrl: body.manifest.url,
    };
  }

  function spyConversion(payload) {
    const realFetch = globalThis.fetch;
    return vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      if (String(url).startsWith(CONVERSION_URL_PREFIX)) {
        if (payload === false) return Promise.resolve({ ok: false, status: 422 });
        return Promise.resolve({
          ok: true,
          json: async () => payload,
        });
      }
      return realFetch(url, opts);
    });
  }

  it('persists conversion, clears cache, and redirects to onboarding by default', async () => {
    const [userId] = await db('users').insert({
      github_id: 60,
      username: 'setup',
      status: 'approved',
      admin: 1,
      onboarding_completed: 0,
    });

    await db('instance_settings').where({ id: 1 }).update({
      github_app_client_id: 'old-id',
      github_app_client_secret_encrypted: 'enc-old',
      github_app_slug: 'old-slug',
    });

    const started = await startManifest(userId);
    const fetchSpy = spyConversion({
      id: 777,
      slug: 'baguette-new',
      client_id: 'new-client',
      client_secret: 'new-secret',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nkey\n-----END RSA PRIVATE KEY-----',
      webhook_secret: 'hook-secret',
      external_url: started.externalUrl,
    });

    try {
      const res = await get(`/auth/github/manifest/callback?code=manifest-temp`, {
        cookie: started.cookie,
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/onboarding');

      const row = await db('instance_settings').where({ id: 1 }).first();
      expect(row.github_app_id).toBe(777);
      expect(row.github_app_slug).toBe('baguette-new');
      expect(row.github_app_client_id).toBe('new-client');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns 401/403 without an admin session', async () => {
    const unauth = await get('/auth/github/manifest/callback?code=abc');
    expect(unauth.status).toBe(401);

    const [userId] = await db('users').insert({
      github_id: 61,
      username: 'notadmin',
      status: 'approved',
      admin: 0,
    });
    const forbidden = await get('/auth/github/manifest/callback?code=abc', {
      cookie: signedUserCookie(userId),
    });
    expect(forbidden.status).toBe(403);
  });

  it('rejects a callback without the manifest state cookie', async () => {
    const [userId] = await db('users').insert({
      github_id: 63,
      username: 'admin-csrf',
      status: 'approved',
      admin: 1,
    });

    await db('instance_settings').where({ id: 1 }).update({
      github_app_client_id: 'keep-me',
      github_app_slug: 'keep-slug',
    });

    const res = await get('/auth/github/manifest/callback?code=forged', {
      cookie: signedUserCookie(userId),
    });
    expect(res.status).toBe(403);

    const row = await db('instance_settings').where({ id: 1 }).first();
    expect(row.github_app_client_id).toBe('keep-me');
    expect(row.github_app_slug).toBe('keep-slug');
  });

  it('rejects a conversion whose homepage does not echo the nonce', async () => {
    const [userId] = await db('users').insert({
      github_id: 64,
      username: 'admin-mismatch',
      status: 'approved',
      admin: 1,
    });

    await db('instance_settings').where({ id: 1 }).update({
      github_app_client_id: 'keep-me',
      github_app_slug: 'keep-slug',
    });

    const started = await startManifest(userId);
    const fetchSpy = spyConversion({
      id: 888,
      slug: 'attacker-app',
      client_id: 'evil-client',
      client_secret: 'evil-secret',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nkey\n-----END RSA PRIVATE KEY-----',
      webhook_secret: 'hook-secret',
      external_url: 'https://evil.example/',
    });

    try {
      const res = await get(
        `/auth/github/manifest/callback?code=attacker-code&state=${started.state}`,
        { cookie: started.cookie }
      );
      expect(res.status).toBe(403);

      const row = await db('instance_settings').where({ id: 1 }).first();
      expect(row.github_app_client_id).toBe('keep-me');
      expect(row.github_app_slug).toBe('keep-slug');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('leaves existing credentials when conversion fails', async () => {
    const [userId] = await db('users').insert({
      github_id: 62,
      username: 'admin2',
      status: 'approved',
      admin: 1,
    });

    await db('instance_settings').where({ id: 1 }).update({
      github_app_client_id: 'keep-me',
      github_app_slug: 'keep-slug',
      github_app_client_secret_encrypted: 'still-here',
    });

    const started = await startManifest(userId);
    const fetchSpy = spyConversion(false);

    try {
      const res = await get(`/auth/github/manifest/callback?code=bad-code&state=${started.state}`, {
        cookie: started.cookie,
      });
      expect(res.status).toBe(502);

      const row = await db('instance_settings').where({ id: 1 }).first();
      expect(row.github_app_client_id).toBe('keep-me');
      expect(row.github_app_slug).toBe('keep-slug');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('POST /auth/bootstrap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates the first admin without a bootstrap password gate', async () => {
    const res = await post('/auth/bootstrap', { body: {} });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({
      username: 'bootstrap',
      approved: true,
      admin: true,
      onboarding_completed: false,
    });

    const cookie = res.headers.get('set-cookie');
    userIdFromSetCookie(cookie);

    const row = await db('users').where({ id: body.user.id }).first();
    expect(row.github_id).toBeNull();
    expect(row.status).toBe('approved');
    expect(row.admin).toBe(1);
    expect(row.last_ip).toBeTruthy();
    expect(row.last_ip_country).toBeNull();
    expect(row.last_seen_at).toBeTruthy();
  });

  it('rejects a wrong password and accepts the correct one', async () => {
    vi.stubEnv('BOOTSTRAP_PASSWORD', 'hunter2');

    const bad = await post('/auth/bootstrap', { body: { password: 'wrong' } });
    expect(bad.status).toBe(403);
    expect(await db('users').count('* as count').first()).toMatchObject({ count: 0 });

    const ok = await post('/auth/bootstrap', { body: { password: 'hunter2' } });
    expect(ok.status).toBe(200);
    expect((await db('users').count('* as count').first()).count).toBe(1);
  });

  it('returns 409 when bootstrap was already claimed', async () => {
    const first = await post('/auth/bootstrap', { body: {} });
    expect(first.status).toBe(200);

    const second = await post('/auth/bootstrap', { body: {} });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: 'Bootstrap already taken' });
  });
});

describe('POST /auth/passkey/register/options and /auth/passkey/register/verify', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await post('/auth/passkey/register/options', { body: {} });
    expect(res.status).toBe(401);
  });

  it('sets the webauthn_challenge cookie and stores a passkey on verify', async () => {
    const [userId] = await db('users').insert({
      github_id: null,
      username: 'bootstrap',
      status: 'approved',
      admin: 1,
    });
    const sessionCookie = signedUserCookie(userId);

    const optionsRes = await post('/auth/passkey/register/options', {
      body: { username: 'ada' },
      cookie: sessionCookie,
    });
    expect(optionsRes.status).toBe(200);
    const optionsBody = await optionsRes.json();
    expect(optionsBody.challenge).toBe('reg-challenge-b64');
    const challengeCookie = optionsRes.headers.get('set-cookie');
    expect(challengeCookie).toContain('webauthn_challenge=');

    const verifyRes = await post('/auth/passkey/register/verify', {
      body: { id: 'cred-id-b64', response: {}, username: 'ada' },
      cookie: `${sessionCookie}; ${challengeCookie}`,
    });
    expect(verifyRes.status).toBe(200);
    expect(await verifyRes.json()).toEqual({ ok: true, passkey_count: 1 });

    const row = await db('user_passkeys').where({ user_id: userId }).first();
    expect(row.credential_id).toBe('cred-id-b64');
    const user = await db('users').where({ id: userId }).first();
    expect(user.username).toBe('ada');
  });

  it('returns 400 when the registration challenge cookie is missing', async () => {
    const [userId] = await db('users').insert({
      github_id: null,
      username: 'bootstrap',
      status: 'approved',
      admin: 1,
    });

    const res = await post('/auth/passkey/register/verify', {
      body: { id: 'cred-id-b64', response: {} },
      cookie: signedUserCookie(userId),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/passkey/options and /auth/passkey/verify', () => {
  it('sets userId cookie on successful login for a pending user', async () => {
    const [userId] = await db('users').insert({
      github_id: null,
      username: 'passkey-user',
      status: 'pending',
      admin: 0,
    });
    await db('user_passkeys').insert({
      user_id: userId,
      credential_id: 'pk-cred-1',
      public_key: 'AQID',
      counter: 0,
    });

    const optionsRes = await post('/auth/passkey/options');
    expect(optionsRes.status).toBe(200);
    const optionsBody = await optionsRes.json();
    expect(optionsBody.challenge).toBe('login-challenge-b64');
    const challengeCookie = optionsRes.headers.get('set-cookie');
    expect(challengeCookie).toContain('webauthn_challenge=');

    const verifyRes = await post('/auth/passkey/verify', {
      body: { id: 'pk-cred-1', response: { clientDataJSON: 'x' } },
      cookie: challengeCookie,
    });

    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.user).toMatchObject({
      id: userId,
      username: 'passkey-user',
      approved: false,
      admin: false,
    });
    userIdFromSetCookie(verifyRes.headers.get('set-cookie'));
  });
});

describe('GET /auth/invite/:token and passkey accept', () => {
  async function seedInvite({ expired = false } = {}) {
    const token = generateInviteToken();
    const [id] = await db('users').insert({
      github_id: null,
      username: 'later-user',
      status: 'approved',
      admin: 0,
      invite_token_hash: hashInviteToken(token),
      invite_expires_at: expired ? new Date(Date.now() - 1000).toISOString() : inviteExpiresAt(),
    });
    return { id, token };
  }

  it('returns 404 for an unknown token', async () => {
    const res = await get('/auth/invite/bginv_missing');
    expect(res.status).toBe(404);
  });

  it('returns 410 when the invite has expired', async () => {
    const { token } = await seedInvite({ expired: true });
    const res = await get(`/auth/invite/${token}`);
    expect(res.status).toBe(410);
  });

  it('returns 400 when already signed in', async () => {
    const { id, token } = await seedInvite();
    const res = await get(`/auth/invite/${token}`, { cookie: signedUserCookie(id) });
    expect(res.status).toBe(400);
  });

  it('returns the invited username', async () => {
    const { token } = await seedInvite();
    const res = await get(`/auth/invite/${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: 'later-user' });
  });

  it('registers a passkey and consumes the invite', async () => {
    const { id, token } = await seedInvite();

    const optionsRes = await post(`/auth/invite/${token}/options`);
    expect(optionsRes.status).toBe(200);
    const optionsBody = await optionsRes.json();
    expect(optionsBody.challenge).toBe('reg-challenge-b64');
    expect(webauthnServerMock.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: 'later-user',
        authenticatorSelection: expect.objectContaining({ residentKey: 'required' }),
      })
    );
    const challengeCookie = optionsRes.headers.get('set-cookie');
    expect(challengeCookie).toContain('webauthn_challenge=');

    const verifyRes = await post(`/auth/invite/${token}/verify`, {
      body: { id: 'cred-id-b64', response: {} },
      cookie: challengeCookie,
    });
    expect(verifyRes.status).toBe(200);
    const body = await verifyRes.json();
    expect(body.user).toMatchObject({
      id,
      username: 'later-user',
      approved: true,
      admin: false,
      onboarding_completed: false,
    });
    userIdFromSetCookie(verifyRes.headers.get('set-cookie'));

    const row = await db('users').where({ id }).first();
    expect(row.invite_token_hash).toBeNull();
    expect(row.invite_expires_at).toBeNull();
    expect(row.last_ip).toBeTruthy();

    const passkey = await db('user_passkeys').where({ user_id: id }).first();
    expect(passkey.credential_id).toBe('cred-id-b64');

    const reused = await post(`/auth/invite/${token}/verify`, {
      body: { id: 'cred-id-b64', response: {} },
      cookie: challengeCookie,
    });
    expect(reused.status).toBe(404);
  });
});

describe('GET /auth/github/callback GitHub account linking', () => {
  const GITHUB_USER = { id: 9001, login: 'linked', avatar_url: 'https://a', email: 'a@b.c' };

  function mockGithubOAuth() {
    const realFetch = globalThis.fetch;
    return vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      if (String(url).startsWith(GITHUB_TOKEN_URL)) {
        return Promise.resolve({ json: async () => ({ access_token: 'gh-token' }) });
      }
      if (String(url) === 'https://api.github.com/user') {
        return Promise.resolve({ json: async () => GITHUB_USER });
      }
      return realFetch(url, opts);
    });
  }

  it('merges GitHub onto the cookied bootstrap user', async () => {
    const [bootstrapId] = await db('users').insert({
      github_id: null,
      username: 'bootstrap',
      status: 'approved',
      admin: 1,
    });

    const fetchSpy = mockGithubOAuth();
    try {
      const res = await get('/auth/github/callback?code=oauth-code', {
        cookie: signedUserCookie(bootstrapId),
      });
      expect(res.status).toBe(302);

      const row = await db('users').where({ id: bootstrapId }).first();
      expect(row.github_id).toBe(GITHUB_USER.id);
      expect(row.username).toBe('linked');
      expect(Number((await db('users').count('* as count').first()).count)).toBe(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns 409 when github_id belongs to another user', async () => {
    const [bootstrapId] = await db('users').insert({
      github_id: null,
      username: 'bootstrap',
      status: 'approved',
      admin: 1,
    });
    await db('users').insert({
      github_id: GITHUB_USER.id,
      username: 'other',
      status: 'approved',
    });

    const fetchSpy = mockGithubOAuth();
    try {
      const res = await get('/auth/github/callback?code=oauth-code', {
        cookie: signedUserCookie(bootstrapId),
      });
      expect(res.status).toBe(409);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
