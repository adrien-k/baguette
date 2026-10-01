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
  listModels: vi.fn().mockResolvedValue([{ id: 'sonnet', display_name: 'Sonnet' }]),
  refreshModels: vi.fn(),
}));
vi.mock('../../services/cursor-models.js', () => ({
  listCursorModels: vi.fn().mockResolvedValue([]),
  refreshCursorModels: vi.fn(),
}));
vi.mock('../../lib/encrypt.js', () => ({
  decrypt: vi.fn((v) => (v === 'enc-ant' ? 'sk-ant' : v)),
}));

import createSettingsRoutes from '../settings.js';

const db = createTestDb({ beforeEach, afterEach });
const USER = 1;

let server;
let baseUrl;

beforeEach(async () => {
  dbMock.ref.current = db;
  await db('users').insert({
    id: USER,
    github_id: 'gh-1',
    username: 'alice',
    anthropic_api_key_encrypted: 'enc-ant',
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
  await new Promise((resolve) => server.close(resolve));
});

describe('agent-defaults settings routes', () => {
  it('GET returns empty defaults', async () => {
    const res = await fetch(`${baseUrl}/api/settings/agent-defaults`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      agent_sdk: null,
      model: null,
      model_params: null,
      use_last_used: true,
    });
  });

  it('PUT validates SDK against account keys and persists', async () => {
    const putRes = await fetch(`${baseUrl}/api/settings/agent-defaults`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_sdk: 'claude', model: 'sonnet', model_params: null }),
    });
    const putBody = await putRes.json();
    expect(putRes.status).toBe(200);
    expect(putBody).toEqual({
      agent_sdk: 'claude',
      model: 'sonnet',
      model_params: null,
      use_last_used: false,
    });

    const getRes = await fetch(`${baseUrl}/api/settings/agent-defaults`);
    expect(await getRes.json()).toEqual(putBody);
  });

  it('PUT rejects SDK without API key', async () => {
    const res = await fetch(`${baseUrl}/api/settings/agent-defaults`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_sdk: 'cursor', model: null, model_params: null }),
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.message || body.error).toMatch(/cursor/i);
  });
});
