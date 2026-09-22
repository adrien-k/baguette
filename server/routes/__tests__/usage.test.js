/**
 * Tests for the usage endpoint backing the dashboard cost graph. It must scope rows to the
 * signed-in user, break them down by day/repo/sdk, and honour the `?repo=` filter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createTestDb } from '../../test-utils/db.js';

vi.mock('../../config.js', () => ({ DOCKER_COMPOSE_PATH: '/tmp/does-not-exist.yml' }));

const dbMock = vi.hoisted(() => {
  const ref = { current: null };
  const proxy = (table) => ref.current(table);
  proxy.raw = (...args) => ref.current.raw(...args);
  return { ref, proxy };
});
vi.mock('../../db.js', () => ({ default: dbMock.proxy }));

vi.mock('../../services/agent-settings.js', () => ({ getGithubToken: vi.fn() }));
vi.mock('../../services/anthropic-models.js', () => ({
  listModels: vi.fn(),
  refreshModels: vi.fn(),
}));
vi.mock('../../services/cursor-models.js', () => ({
  listCursorModels: vi.fn(),
  refreshCursorModels: vi.fn(),
}));
vi.mock('../../lib/encrypt.js', () => ({ decrypt: vi.fn() }));

import createSettingsRoutes from '../settings.js';

const db = createTestDb({ beforeEach, afterEach });

const USER = 1;
const OTHER_USER = 2;

let server;
let baseUrl;

beforeEach(async () => {
  dbMock.ref.current = db;

  await db('users').insert([
    { id: USER, github_id: 'gh-1', username: 'alice' },
    { id: OTHER_USER, github_id: 'gh-2', username: 'bob' },
  ]);

  const app = express();
  app.use(
    createSettingsRoutes((req, res, next) => {
      req.user = { id: USER };
      next();
    })
  );

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const getJson = async (path) => {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body;
};

/** `usage.session_id` is NOT NULL, so every usage row needs an owning session. */
async function createSession(userId, repo) {
  const [row] = await db('sessions')
    .insert({
      user_id: userId,
      repo_full_name: repo,
      base_branch: 'main',
      initial_prompt: 'test',
    })
    .returning('id');
  return typeof row === 'object' ? row.id : row;
}

async function insertUsage(rows) {
  for (const r of rows) {
    const userId = r.user_id ?? USER;
    await db('usage').insert({
      session_id: await createSession(userId, r.repo),
      user_id: userId,
      repo_full_name: r.repo,
      cost_usd: r.cost,
      agent_sdk: r.sdk ?? 'claude',
      created_at: r.created_at ?? daysAgo(1),
    });
  }
}

describe('GET /api/usage/breakdown', () => {
  it('returns only the requested repo when ?repo= is given', async () => {
    const day = daysAgo(1);
    await insertUsage([
      { repo: 'acme/alpha', cost: 1.5, created_at: day },
      { repo: 'acme/beta', cost: 10, created_at: day },
    ]);

    const all = await getJson('/api/usage/breakdown');
    expect(all.map((r) => r.repo_full_name).sort()).toEqual(['acme/alpha', 'acme/beta']);

    const scoped = await getJson('/api/usage/breakdown?repo=acme%2Falpha');
    expect(scoped).toEqual([
      { day: day.slice(0, 10), repo_full_name: 'acme/alpha', agent_sdk: 'claude', cost_usd: 1.5 },
    ]);
  });

  it('splits a day by repo and by sdk, summing repeated rows', async () => {
    const day = daysAgo(2);
    await insertUsage([
      { repo: 'acme/alpha', cost: 1, created_at: day },
      { repo: 'acme/alpha', cost: 2, created_at: day },
      { repo: 'acme/alpha', cost: 4, sdk: 'cursor', created_at: day },
      { repo: 'acme/beta', cost: 8, sdk: 'cursor', created_at: day },
    ]);

    const rows = await getJson('/api/usage/breakdown');
    const cost = (repo, sdk) =>
      rows.find((r) => r.repo_full_name === repo && r.agent_sdk === sdk)?.cost_usd;

    expect(rows).toHaveLength(3);
    expect(cost('acme/alpha', 'claude')).toBeCloseTo(3);
    expect(cost('acme/alpha', 'cursor')).toBeCloseTo(4);
    expect(cost('acme/beta', 'cursor')).toBeCloseTo(8);
    expect(rows.every((r) => r.day === day.slice(0, 10))).toBe(true);
  });

  it('keeps days separate and ordered oldest first', async () => {
    await insertUsage([
      { repo: 'acme/alpha', cost: 1, created_at: daysAgo(1) },
      { repo: 'acme/alpha', cost: 2, created_at: daysAgo(3) },
    ]);

    const rows = await getJson('/api/usage/breakdown');
    expect(rows.map((r) => r.cost_usd)).toEqual([2, 1]);
  });

  it('excludes other users and rows older than 30 days', async () => {
    await insertUsage([
      { repo: 'acme/alpha', cost: 5, user_id: OTHER_USER },
      { repo: 'acme/alpha', cost: 7, created_at: daysAgo(31) },
    ]);

    expect(await getJson('/api/usage/breakdown')).toEqual([]);
  });
});
