/**
 * Usage Feathers service: system-wide breakdown, agent-config filter list, active agents.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { ensureReviewerAgentRow } from '../agents-db.js';
import { registerUsageService } from '../feathers/usage.service.js';

const db = createTestDb();

const USER = 1;
const OTHER_USER = 2;

const params = (userId) => ({ provider: 'rest', user: { id: userId } });

let app;
let svc;
let claudeConfigId;
let cursorConfigId;

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/** `usage.session_id` is NOT NULL, so every usage row needs an owning session. */
async function createSession(userId, repo, { agent_config_id = null, agent_sdk = 'claude' } = {}) {
  return insertTestSession(db, {
    user_id: userId,
    repo_full_name: repo,
    base_branch: 'main',
    initial_prompt: 'test',
    agent_config_id,
    agent_sdk,
  });
}

async function insertUsage(rows) {
  for (const r of rows) {
    const userId = r.user_id ?? USER;
    const agentConfigId =
      r.agent_config_id ??
      (r.sdk === 'cursor' ? cursorConfigId : r.sdk === 'pi' ? null : claudeConfigId);
    await db('usage').insert({
      session_id: await createSession(userId, r.repo, { agent_config_id: agentConfigId }),
      user_id: userId,
      repo_full_name: r.repo,
      cost_usd: r.cost,
      agent_sdk: r.sdk ?? 'claude',
      agent_config_id: agentConfigId,
      created_at: r.created_at ?? daysAgo(1),
      input_tokens: r.input ?? 0,
      output_tokens: r.output ?? 0,
      total_tokens: (r.input ?? 0) + (r.output ?? 0),
      cache_read_tokens: r.cacheRead ?? 0,
      cache_write_tokens: r.cacheWrite ?? 0,
      model: r.model ?? null,
      agent_type:
        r.agent_type ?? (r.kind === 'review' ? 'reviewer' : r.kind ? 'builder' : 'builder'),
    });
  }
}

beforeEach(async () => {
  await db('users').insert([
    { id: USER, github_id: 'gh-1', username: 'alice' },
    { id: OTHER_USER, github_id: 'gh-2', username: 'bob' },
  ]);

  [claudeConfigId] = await db('agent_configs').insert({
    user_id: USER,
    label: 'Alice Claude',
    sdk: 'claude',
  });
  [cursorConfigId] = await db('agent_configs').insert({
    user_id: USER,
    label: 'Alice Cursor',
    sdk: 'cursor',
  });

  app = feathers();
  app.set('db', db);
  registerUsageService(app);
  await app.setup();
  svc = app.service('usage');
});

describe('usage.breakdown', () => {
  it('returns only the requested agent config when agent_config_id is given', async () => {
    const day = daysAgo(1);
    await insertUsage([
      { repo: 'acme/alpha', cost: 1, input: 100, output: 10, created_at: day },
      { repo: 'acme/alpha', cost: 0, input: 500, output: 50, sdk: 'cursor', created_at: day },
    ]);

    const claude = await svc.breakdown({ agent_config_id: String(claudeConfigId) }, params(USER));
    expect(claude).toHaveLength(1);
    expect(claude[0].agent_config_id).toBe(claudeConfigId);
    expect(claude[0].agent_config_label).toBe('Alice Claude');
    expect(claude[0].total_tokens).toBe(110);

    const cursor = await svc.breakdown({ agent_config_id: String(cursorConfigId) }, params(USER));
    expect(cursor).toHaveLength(1);
    expect(cursor[0].agent_config_id).toBe(cursorConfigId);
    expect(cursor[0].total_tokens).toBe(550);
  });

  it('returns only the requested repo when repo is given', async () => {
    const day = daysAgo(1);
    await insertUsage([
      { repo: 'acme/alpha', cost: 1.5, created_at: day },
      { repo: 'acme/beta', cost: 10, created_at: day },
    ]);

    const all = await svc.breakdown({}, params(USER));
    expect(all.map((r) => r.repo_full_name).sort()).toEqual(['acme/alpha', 'acme/beta']);

    const scoped = await svc.breakdown({ repo: 'acme/alpha' }, params(USER));
    expect(scoped).toEqual([
      {
        day: day.slice(0, 10),
        repo_full_name: 'acme/alpha',
        agent_config_id: claudeConfigId,
        agent_config_label: 'Alice Claude',
        agent_sdk: 'claude',
        agent_type: 'builder',
        model: '',
        cost_usd: 1.5,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 0,
      },
    ]);
  });

  it('splits a day by repo and by agent config, summing repeated rows', async () => {
    const day = daysAgo(2);
    await insertUsage([
      { repo: 'acme/alpha', cost: 1, created_at: day },
      { repo: 'acme/alpha', cost: 2, created_at: day },
      { repo: 'acme/alpha', cost: 4, sdk: 'cursor', created_at: day },
      { repo: 'acme/beta', cost: 8, sdk: 'cursor', created_at: day },
    ]);

    const rows = await svc.breakdown({}, params(USER));
    const cost = (repo, configId) =>
      rows.find((r) => r.repo_full_name === repo && r.agent_config_id === configId)?.cost_usd;

    expect(rows).toHaveLength(3);
    expect(cost('acme/alpha', claudeConfigId)).toBeCloseTo(3);
    expect(cost('acme/alpha', cursorConfigId)).toBeCloseTo(4);
    expect(cost('acme/beta', cursorConfigId)).toBeCloseTo(8);
    expect(rows.every((r) => r.day === day.slice(0, 10))).toBe(true);
  });

  it('keeps days separate and ordered oldest first', async () => {
    await insertUsage([
      { repo: 'acme/alpha', cost: 1, created_at: daysAgo(1) },
      { repo: 'acme/alpha', cost: 2, created_at: daysAgo(3) },
    ]);

    const rows = await svc.breakdown({}, params(USER));
    expect(rows.map((r) => r.cost_usd)).toEqual([2, 1]);
  });

  it('sums token columns alongside cost', async () => {
    const day = daysAgo(2);
    await insertUsage([
      { repo: 'acme/alpha', cost: 1, input: 1000, output: 200, created_at: day },
      { repo: 'acme/alpha', cost: 2, input: 500, output: 50, created_at: day },
    ]);

    const [row] = await svc.breakdown({}, params(USER));
    expect(row.input_tokens).toBe(1500);
    expect(row.output_tokens).toBe(250);
    expect(row.total_tokens).toBe(1750);
  });

  it('sums cache read and write tokens', async () => {
    const day = daysAgo(2);
    await insertUsage([
      {
        repo: 'acme/alpha',
        cost: 1,
        input: 10,
        output: 2,
        cacheRead: 100,
        cacheWrite: 20,
        created_at: day,
      },
      {
        repo: 'acme/alpha',
        cost: 0,
        input: 5,
        output: 1,
        cacheRead: 50,
        cacheWrite: 8,
        created_at: day,
      },
    ]);

    const [row] = await svc.breakdown({}, params(USER));
    expect(row.cache_read_tokens).toBe(150);
    expect(row.cache_write_tokens).toBe(28);
  });

  it('splits a day by model', async () => {
    const day = daysAgo(1);
    await insertUsage([
      {
        repo: 'acme/alpha',
        cost: 1,
        input: 100,
        output: 0,
        model: 'claude-opus-4',
        created_at: day,
      },
      {
        repo: 'acme/alpha',
        cost: 2,
        input: 40,
        output: 0,
        model: 'claude-haiku-4-5',
        created_at: day,
      },
    ]);

    const rows = await svc.breakdown({}, params(USER));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.model === 'claude-opus-4').total_tokens).toBe(100);
    expect(rows.find((r) => r.model === 'claude-haiku-4-5').total_tokens).toBe(40);
  });

  it('reports tokens for rows that carry no cost', async () => {
    await insertUsage([{ repo: 'acme/alpha', cost: 0, input: 8007, output: 12, sdk: 'cursor' }]);

    const [row] = await svc.breakdown({}, params(USER));
    expect(row.cost_usd).toBe(0);
    expect(row.total_tokens).toBe(8019);
  });

  it('includes all users by default and can filter with user_id', async () => {
    const day = daysAgo(1);
    await insertUsage([
      { repo: 'acme/alpha', cost: 5, user_id: OTHER_USER, created_at: day },
      { repo: 'acme/beta', cost: 3, created_at: day },
    ]);

    const all = await svc.breakdown({}, params(USER));
    expect(all.map((r) => r.cost_usd).sort()).toEqual([3, 5]);

    const bob = await svc.breakdown({ user_id: String(OTHER_USER) }, params(USER));
    expect(bob).toHaveLength(1);
    expect(bob[0].cost_usd).toBe(5);
  });

  it('excludes rows older than 30 days by default', async () => {
    await insertUsage([{ repo: 'acme/alpha', cost: 7, created_at: daysAgo(31) }]);
    expect(await svc.breakdown({}, params(USER))).toEqual([]);
  });

  it('honours days=7 and days=90 windows', async () => {
    await insertUsage([
      { repo: 'acme/alpha', cost: 1, input: 10, output: 0, created_at: daysAgo(10) },
      { repo: 'acme/alpha', cost: 2, input: 20, output: 0, created_at: daysAgo(45) },
    ]);

    expect(await svc.breakdown({ days: '7' }, params(USER))).toEqual([]);
    expect((await svc.breakdown({}, params(USER))).map((r) => r.total_tokens)).toEqual([10]);
    expect(
      (await svc.breakdown({ days: '90' }, params(USER))).map((r) => r.total_tokens).sort()
    ).toEqual([10, 20]);
  });

  it('splits builder vs reviewer activity and honours kind=review filter compat', async () => {
    const day = daysAgo(1);
    await insertUsage([
      { repo: 'acme/alpha', cost: 1, input: 100, output: 0, created_at: day },
      {
        repo: 'acme/alpha',
        cost: 2,
        input: 50,
        output: 0,
        created_at: day,
        agent_type: 'reviewer',
      },
    ]);

    const all = await svc.breakdown({}, params(USER));
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.agent_type === 'builder').total_tokens).toBe(100);
    expect(all.find((r) => r.agent_type === 'reviewer').total_tokens).toBe(50);

    const review = await svc.breakdown({ kind: 'review' }, params(USER));
    expect(review).toHaveLength(1);
    expect(review[0].agent_type).toBe('reviewer');
    expect(review[0].total_tokens).toBe(50);
  });

  it('treats repo=__global__ as sessions with an empty repo', async () => {
    const day = daysAgo(1);
    await insertUsage([
      { repo: '', cost: 0, input: 40, output: 0, created_at: day },
      { repo: 'acme/alpha', cost: 0, input: 10, output: 0, created_at: day },
    ]);

    const scoped = await svc.breakdown({ repo: '__global__' }, params(USER));
    expect(scoped).toHaveLength(1);
    expect(scoped[0].repo_full_name).toBe('');
    expect(scoped[0].total_tokens).toBe(40);
  });
});

describe('usage.usageUsers', () => {
  it('returns distinct users with usage in the window and supports search', async () => {
    const day = daysAgo(1);
    await insertUsage([
      { repo: 'acme/a', cost: 1, user_id: USER, created_at: day },
      { repo: 'acme/b', cost: 1, user_id: OTHER_USER, created_at: day },
    ]);

    const all = await svc.usageUsers({ days: '30' }, params(USER));
    expect(all.map((r) => r.user_id).sort()).toEqual([USER, OTHER_USER]);
    expect(all.find((r) => r.user_id === USER).username).toBe('alice');

    const bobOnly = await svc.usageUsers({ days: '30', q: 'bob' }, params(USER));
    expect(bobOnly).toHaveLength(1);
    expect(bobOnly[0].user_id).toBe(OTHER_USER);
    expect(bobOnly[0].username).toBe('bob');
  });
});

describe('usage.activeAgents', () => {
  it('returns chat and review agents for all users by default', async () => {
    const runningSessionId = await insertTestSession(db, {
      user_id: USER,
      short_id: 'run12345',
      label: 'Feature work',
      repo_full_name: 'acme/app',
      base_branch: 'main',
      initial_prompt: 'go',
      status: 'running',
      agent_sdk: 'claude',
      model: 'claude-sonnet-4-20250514',
    });
    await ensureReviewerAgentRow(db, runningSessionId, {
      agent_sdk: 'cursor',
      model: 'composer',
      status: 'running',
    });
    await insertTestSession(db, {
      user_id: OTHER_USER,
      short_id: 'other111',
      repo_full_name: 'acme/other',
      base_branch: 'main',
      initial_prompt: 'go',
      status: 'running',
    });

    const rows = await svc.activeAgents({}, params(USER));
    expect(rows).toHaveLength(3);
    expect(
      rows
        .filter((r) => r.short_id === 'run12345')
        .map((r) => r.agent_type)
        .sort()
    ).toEqual(['builder', 'reviewer']);
    expect(rows.every((r) => r.session_id)).toBe(true);
    expect(rows.find((r) => r.agent_type === 'builder' && r.short_id === 'run12345').model).toBe(
      'claude-sonnet-4-20250514'
    );
    expect(rows.find((r) => r.agent_type === 'reviewer').agent_sdk).toBe('cursor');

    const scoped = await svc.activeAgents({ user_id: String(USER) }, params(USER));
    expect(scoped).toHaveLength(2);
    expect(scoped.every((r) => r.short_id === 'run12345')).toBe(true);
  });

  it('returns an empty list when nothing is running', async () => {
    await insertTestSession(db, {
      user_id: USER,
      short_id: 'done1111',
      repo_full_name: 'acme/app',
      base_branch: 'main',
      initial_prompt: 'go',
      status: 'completed',
    });
    expect(await svc.activeAgents({}, params(USER))).toEqual([]);
  });
});
