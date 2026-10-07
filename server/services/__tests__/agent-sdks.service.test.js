import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers } from '@feathersjs/feathers';

import { createTestDb } from '../../test-utils/db.js';

vi.mock('../anthropic-models.js', () => ({
  listModels: vi.fn().mockResolvedValue([{ id: 'sonnet', display_name: 'Sonnet' }]),
}));
vi.mock('../cursor-models.js', () => ({
  listCursorModels: vi.fn().mockResolvedValue([]),
  refreshCursorModels: vi.fn().mockResolvedValue([{ id: 'c1', display_name: 'Cursor 1' }]),
}));
const cursorTestMock = vi.hoisted(() => vi.fn());
vi.mock('../cursor-connectivity.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runCursorConnectivityTest: cursorTestMock.mockImplementation(async ({ apiKey }) => ({
      ok: Boolean(apiKey),
      effective: { cursor_api_key_configured: Boolean(apiKey) },
      checks: [{ id: 'auth', label: 'Authentication', ok: Boolean(apiKey) }],
    })),
  };
});
vi.mock('../../lib/encrypt.js', () => ({
  encrypt: vi.fn((v) => `enc:${v}`),
  decrypt: vi.fn((v) => (v === 'enc-ant' ? 'sk-ant' : (v?.replace?.(/^enc:/, '') ?? v))),
}));

import { testClaudeCredentials, testCursorCredentials } from '../agent-sdk-credential-test.js';
import { registerUsersService } from '../feathers/users.service.js';
import { registerReposService } from '../feathers/repos.service.js';
import { registerAgentSdksService, registerAgentSdk } from '../feathers/agent-sdks.service.js';

const db = createTestDb({ beforeEach, afterEach });
const params = (user) => ({ provider: 'rest', user });

let app;
let user1;
let defaultRepoId;

function registerStubAgentServices(application) {
  class StubClaudeAgent {
    testCredentials({ user, repo, payload }) {
      return testClaudeCredentials(user, repo, payload);
    }
    async isEnabled(ctx) {
      const u = ctx.user;
      const r = ctx.repo;
      return Boolean(
        u?.anthropic_api_key ||
        u?.anthropic_auth_token ||
        r?.anthropic_api_key ||
        r?.anthropic_auth_token
      );
    }
    async listModels(_ctx, { refresh = false } = {}) {
      if (refresh) return [{ id: 'c1', display_name: 'Cursor 1' }];
      return [{ id: 'sonnet', display_name: 'Sonnet' }];
    }
    get() {
      return null;
    }
  }
  class StubCursorAgent {
    testCredentials({ user, repo, payload }) {
      return testCursorCredentials(user, repo, payload);
    }
    async isEnabled(ctx) {
      return Boolean(ctx.user?.cursor_api_key || ctx.repo?.cursor_api_key);
    }
    async listModels(_ctx, { refresh = false } = {}) {
      if (refresh) return [{ id: 'c1', display_name: 'Cursor 1' }];
      return [];
    }
    get() {
      return null;
    }
  }
  class StubPiAgent {
    testCredentials() {
      return Promise.resolve({ ok: true, checks: [] });
    }
    async isEnabled() {
      return false;
    }
    async listModels() {
      return [];
    }
    get() {
      return null;
    }
  }
  registerAgentSdksService(application);
  application.use('claude-agent', new StubClaudeAgent());
  application.use('cursor-agent', new StubCursorAgent());
  application.use('pi-agent', new StubPiAgent());
  registerAgentSdk(application, { key: 'claude', label: 'Claude', servicePath: 'claude-agent' });
  registerAgentSdk(application, { key: 'cursor', label: 'Cursor', servicePath: 'cursor-agent' });
  registerAgentSdk(application, { key: 'pi', label: 'Pi', servicePath: 'pi-agent' });
}

function makeApp() {
  const application = feathers();
  application.set('db', db);
  registerUsersService(application);
  registerReposService(application);
  registerStubAgentServices(application);
  return application;
}

beforeEach(async () => {
  await db('users').insert({
    github_id: 1,
    username: 'alice',
    approved: true,
    anthropic_api_key_encrypted: 'enc-ant',
  });
  user1 = await db('users').where({ username: 'alice' }).first();
  [defaultRepoId] = await db('repos').insert({
    full_name: 'alice/default',
    repo_path: '/tmp/alice-default',
  });
  await db('user_repos').insert({ user_id: user1.id, repo_id: defaultRepoId });

  app = makeApp();
  await app.setup();
});

function fetchUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof Request) return input.url;
  return String(input);
}

function fetchInit(input, init = {}) {
  if (input instanceof Request) {
    const headers = {};
    input.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      method: input.method,
      headers,
      body: input.body,
      ...init,
    };
  }
  return init;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name);
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function mockFetch(responses) {
  const calls = [];
  const fn = vi.fn(async (input, init = {}) => {
    const url = fetchUrl(input);
    let mergedInit = fetchInit(input, init);
    if (input instanceof Request) {
      const text = await input.clone().text();
      if (text) mergedInit = { ...mergedInit, body: text };
    }
    calls.push({ url, init: mergedInit });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    if (next.__network_error) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    return typeof next === 'function' ? next({ url, init: mergedInit }) : next;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const jsonRes = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('agent-sdks service - find', () => {
  it('returns enabled SDKs for account credentials', async () => {
    await app.service('users').patch(user1.id, { anthropic_api_key: 'sk-ant' }, params(user1));
    const result = await app.service('agent-sdks').find({ query: {}, ...params(user1) });
    expect(result.sdks.map((s) => s.key)).toContain('claude');
  });

  it('includes repo-level keys when repo_id is set', async () => {
    const [repoId] = await db('repos').insert({
      full_name: 'alice/cursor-only',
      repo_path: '/tmp/alice-cursor-only',
    });
    await db('user_repos').insert({
      user_id: user1.id,
      repo_id: repoId,
      cursor_api_key_encrypted: 'enc:cursor-repo',
    });
    const result = await app
      .service('agent-sdks')
      .find({ query: { repo_id: repoId }, ...params(user1) });
    expect(result.sdks.map((s) => s.key)).toContain('claude');
    expect(result.sdks.map((s) => s.key)).toContain('cursor');
  });
});

describe('agent-sdks service - models', () => {
  it('rejects unauthenticated calls', async () => {
    await expect(
      app.service('agent-sdks').models(null, { query: { sdk: 'claude', repo_id: defaultRepoId } })
    ).rejects.toThrow(/Authentication required/);
  });

  it('lists Claude models for the signed-in user', async () => {
    const result = await app.service('agent-sdks').models(null, {
      ...params(user1),
      query: { sdk: 'claude', repo_id: defaultRepoId },
    });
    expect(result.models).toEqual([{ id: 'sonnet', display_name: 'Sonnet' }]);
  });

  it('refresh returns refreshed Cursor models when a key is configured', async () => {
    await db('users')
      .where({ id: user1.id })
      .update({ cursor_api_key_encrypted: 'enc:cursor-key' });

    const result = await app.service('agent-sdks').models(null, {
      ...params(user1),
      query: { sdk: 'cursor', repo_id: defaultRepoId, refresh: 'true' },
    });
    expect(result.models).toEqual([{ id: 'c1', display_name: 'Cursor 1' }]);
  });
});

describe('agent-sdks service - test (Claude)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tests the effective saved account config', async () => {
    await db('users')
      .where({ id: user1.id })
      .update({ anthropic_api_key_encrypted: 'enc:sk-ant-api03-saved' });
    const calls = mockFetch([
      jsonRes(200, { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-1' }] }),
    ]);
    const body = await app.service('agent-sdks').test({ sdk: 'claude' }, params(user1));
    expect(body.ok).toBe(true);
    expect(body.effective.anthropic_api_key).toBeUndefined();
    expect(body.effective.anthropic_api_key_configured).toBe(true);
    expect(calls[0].url).toMatch(/\/v1\/models/);
    expect(
      headerValue(calls[0].init.headers, 'x-api-key') ||
        headerValue(calls[0].init.headers, 'Authorization')
    ).toBeTruthy();
  });

  it('uses Authorization: Bearer when an auth token is configured', async () => {
    const calls = mockFetch([jsonRes(200, { data: [{ id: 'gw-model' }] })]);
    await app
      .service('agent-sdks')
      .test({ sdk: 'claude', anthropic_auth_token: 'typed-token' }, params(user1));
    expect(headerValue(calls[0].init.headers, 'Authorization')).toBe('Bearer typed-token');
  });

  it('falls back to the repo auth token for the requested repo scope', async () => {
    await db('users')
      .where({ id: user1.id })
      .update({ anthropic_api_key_encrypted: null, anthropic_auth_token_encrypted: null });
    const [repoId] = await db('repos').insert({
      full_name: 'alice/myrepo',
      repo_path: '/tmp/alice-myrepo',
    });
    await db('user_repos').insert({
      user_id: user1.id,
      repo_id: repoId,
      anthropic_auth_token_encrypted: 'enc:repo-token',
    });
    const calls = mockFetch([jsonRes(200, { data: [{ id: 'gw-model' }] })]);
    await app.service('agent-sdks').test({ sdk: 'claude', repo_id: repoId }, params(user1));
    expect(headerValue(calls[0].init.headers, 'Authorization')).toBe('Bearer repo-token');
  });
});

describe('agent-sdks service - test (Cursor)', () => {
  beforeEach(async () => {
    cursorTestMock.mockClear();
    const [repoId] = await db('repos').insert({
      full_name: 'alice/myrepo',
      repo_path: '/tmp/alice-myrepo-cursor',
    });
    await db('user_repos').insert({
      user_id: user1.id,
      repo_id: repoId,
      cursor_api_key_encrypted: 'enc:cursor-repo',
    });
  });

  it('uses the saved key and reports ok', async () => {
    await db('users')
      .where({ id: user1.id })
      .update({ cursor_api_key_encrypted: 'enc:cursor-saved' });
    const body = await app.service('agent-sdks').test({ sdk: 'cursor' }, params(user1));
    expect(body.ok).toBe(true);
    expect(body.effective.cursor_api_key_configured).toBe(true);
  });

  it('falls back to the repo key for the requested repo scope', async () => {
    await db('users').where({ id: user1.id }).update({ cursor_api_key_encrypted: null });
    const repoId = (await db('repos').where({ full_name: 'alice/myrepo' }).first()).id;
    const body = await app
      .service('agent-sdks')
      .test({ sdk: 'cursor', repo_id: repoId }, params(user1));
    expect(body.ok).toBe(true);
    expect(cursorTestMock).toHaveBeenCalledWith({ apiKey: 'cursor-repo' });
  });

  it('rejects unlinked repositories', async () => {
    await expect(
      app.service('agent-sdks').test({ sdk: 'cursor', repo_id: 999 }, params(user1))
    ).rejects.toThrow(/linked/i);
  });
});
