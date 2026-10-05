import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from '@feathersjs/express';
import { createTestDb } from '../../test-utils/db.js';

vi.mock('../../config.js', () => ({}));

const dbMock = vi.hoisted(() => {
  const ref = { current: null };
  const proxy = (table) => ref.current(table);
  proxy.raw = (...args) => ref.current.raw(...args);
  return { ref, proxy };
});
vi.mock('../../db.js', () => ({ default: dbMock.proxy }));

vi.mock('../../services/agent-settings.js', () => ({ getGithubToken: vi.fn() }));
vi.mock('../../services/anthropic-models.js', () => ({
  listModels: vi.fn().mockResolvedValue([]),
  refreshModels: vi.fn(),
}));
vi.mock('../../services/cursor-models.js', () => ({
  listCursorModels: vi.fn().mockResolvedValue([]),
  refreshCursorModels: vi.fn(),
}));
vi.mock('../../lib/encrypt.js', () => ({
  encrypt: vi.fn((v) => `enc:${v}`),
  decrypt: vi.fn((v) => (v?.startsWith('enc:') ? v.slice(4) : v)),
}));

import createSettingsRoutes from '../settings.js';

const db = createTestDb({ beforeEach, afterEach });
const USER = 1;

let server;
let baseUrl;

beforeEach(async () => {
  dbMock.ref.current = db;
  await db('users').insert({ id: USER, github_id: 'gh-1', username: 'alice' });

  const [repoId] = await db('repos').insert({
    full_name: 'alice/myrepo',
    stripped_name: 'alice-myrepo',
    bare_path: '/nonexistent',
  });
  await db('user_repos').insert({
    user_id: USER,
    repo_id: repoId,
    anthropic_auth_token_encrypted: 'enc:repo-token',
  });

  const app = express();
  app.use(express.json());
  app.use(
    createSettingsRoutes((req, res, next) => {
      req.user = { id: USER };
      next();
    })
  );
  app.use(express.errorHandler());
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise((resolve) => server.close(resolve));
});

const REAL_FETCH = globalThis.fetch.bind(globalThis);

function mockFetch(responses) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    if (next.__network_error) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    return typeof next === 'function' ? next({ url: String(url), init }) : next;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const jsonRes = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function post(body) {
  const res = await REAL_FETCH(`${baseUrl}/api/settings/claude/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/settings/claude/test', () => {
  it('tests the effective saved account config', async () => {
    await db('users')
      .where({ id: USER })
      .update({ anthropic_api_key_encrypted: 'enc:sk-ant-api03-saved' });
    const calls = mockFetch([
      jsonRes(200, { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-1' }] }),
    ]);
    const { status, body } = await post({});
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.effective.anthropic_api_key).toBeUndefined();
    expect(body.effective.anthropic_api_key_configured).toBe(true);
    expect(body.effective.anthropic_auth_token_configured).toBe(false);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=100');
    expect(calls[0].init.headers['x-api-key']).toBe('sk-ant-api03-saved');
    const byId = Object.fromEntries(body.checks.map((c) => [c.id, c]));
    expect(byId.connectivity.ok).toBe(true);
    expect(byId.auth.ok).toBe(true);
    expect(byId.models.detail).toBe('2 models listed');
    expect(byId.model).toBeUndefined();
  });

  it('uses Authorization: Bearer when an auth token is configured', async () => {
    const calls = mockFetch([jsonRes(200, { data: [{ id: 'gw-model' }] })]);
    await post({ anthropic_auth_token: 'typed-token' });
    expect(calls[0].init.headers.Authorization).toBe('Bearer typed-token');
    expect(calls[0].init.headers['x-api-key']).toBeUndefined();
  });

  it('falls back to the repo auth token for the requested repo scope', async () => {
    const repoId = (await db('repos').where({ full_name: 'alice/myrepo' }).first()).id;
    const calls = mockFetch([jsonRes(200, { data: [{ id: 'gw-model' }] })]);
    await post({ repo_id: repoId });
    expect(calls[0].init.headers.Authorization).toBe('Bearer repo-token');
  });

  it('flags auth failures with the API error message', async () => {
    mockFetch([jsonRes(401, { error: { type: 'authentication_error', message: 'bad key' } })]);
    const { body } = await post({});
    expect(body.ok).toBe(false);
    const byId = Object.fromEntries(body.checks.map((c) => [c.id, c]));
    expect(byId.connectivity.ok).toBe(true);
    expect(byId.auth.ok).toBe(false);
    expect(byId.auth.detail).toBe('bad key');
  });
  it('probes /v1/messages when the gateway lacks /v1/models', async () => {
    const calls = mockFetch([
      jsonRes(404, { error: { message: 'not found' } }),
      jsonRes(200, { id: 'msg_1' }),
    ]);
    const { body } = await post({});
    expect(body.ok).toBe(true);
    expect(calls[1].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[1].init.body).toContain('"model":"claude-sonnet-4-5"');
    expect(calls[1].init.body).toContain('"max_tokens":1');
    const byId = Object.fromEntries(body.checks.map((c) => [c.id, c]));
    expect(byId.connectivity.ok).toBe(true);
    expect(byId.models.ok).toBeNull();
    expect(byId.model).toBeUndefined();
  });

  it('reports network failures as connectivity errors', async () => {
    mockFetch([{ __network_error: true }]);
    const { body } = await post({});
    expect(body.ok).toBe(false);
    const byId = Object.fromEntries(body.checks.map((c) => [c.id, c]));
    expect(byId.connectivity.ok).toBe(false);
  });
});
