import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createTestDb } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionIssuesService } from '../feathers/session-issues.service.js';
import { registerSessionReviewService } from '../feathers/session-review.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { gitRevParseShort } from '../github.js';
import { registerClaudeAgentService } from '../feathers/claude-agent.service.ts';
import { mountAgentConfigs } from '../../test-utils/agent-sdks.js';
import { registerAgentSdk } from '../feathers/agent-configs.service.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const tool = (name, description, inputSchema, handler) => ({
    name,
    description,
    inputSchema,
    handler,
  });
  const createSdkMcpServer = vi.fn((opts) => ({ name: opts.name, tools: opts.tools }));
  return { query: vi.fn(), tool, createSdkMcpServer };
});

vi.mock('@cursor/sdk', () => ({
  Agent: { create: vi.fn() },
}));

const db = createTestDb({ beforeEach, afterEach });
const params = (user) => ({ provider: 'rest', user });
const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  await execFileAsync('git', ['-C', cwd, ...args]);
}

async function initGitWorktree() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'baguette-review-wt-'));
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.email', 't@example.com');
  await git(dir, 'config', 'user.name', 't');
  await git(dir, 'commit', '--allow-empty', '-m', 'base');
  await git(dir, 'checkout', '-b', 'feat');
  await git(dir, 'commit', '--allow-empty', '-m', 'session');
  return dir;
}

function makeQueryResult() {
  const gen = reviewStream();
  gen.close = vi.fn();
  return gen;
}

function makeApp(db) {
  const app = feathers();
  app.set('db', db);
  registerSessionsService(app);
  app.use('users', { get: async (id) => ({ id, access_token: 'tok' }) }, { methods: ['get'] });
  registerMessagesService(app);
  registerQueuedMessagesService(app);
  mountAgentConfigs(app);
  registerClaudeAgentService(app);
  app.use(
    'cursor-agent',
    {
      handleMessageCreated: async (row) => {
        if (row.type !== 'user' || row.agent_sdk !== 'cursor') return;
        const session = await db('sessions').where({ id: row.session_id }).first();
        const { outcome, agent } = await app.service('cursor-agent').runTurn({
          session,
          userText: 'review',
        });
        await app.service('session-review').onAgentTurnComplete(session, outcome, {
          sdk: 'cursor',
          agent,
        });
      },
      stopTurn: async () => {},
      runTurn: async () => ({ outcome: 'completed', agent: { agentId: 'rev-cursor' } }),
      buildAgentOptions: async () => ({}),
      writePromptRule: async () => '/tmp/review-rules',
    },
    {
      methods: [
        'handleMessageCreated',
        'stopTurn',
        'runTurn',
        'buildAgentOptions',
        'writePromptRule',
      ],
    }
  );
  registerAgentSdk(app, { key: 'cursor', label: 'Cursor', servicePath: 'cursor-agent' });
  app.use(
    'pi-agent',
    {
      handleMessageCreated: async () => {},
      stopTurn: async () => {},
      buildAgentOptions: async () => ({}),
    },
    {
      methods: ['handleMessageCreated', 'stopTurn', 'buildAgentOptions'],
    }
  );
  registerAgentSdk(app, { key: 'pi', label: 'Pi', servicePath: 'pi-agent' });
  registerSessionIssuesService(app);
  registerSessionReviewService(app);
  return app;
}

async function* reviewStream() {
  yield {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Looks good' }] },
  };
  yield {
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: 0.01,
    modelUsage: {
      sonnet: { inputTokens: 10, outputTokens: 5 },
    },
  };
}

let app;
let user;
let sessionId;

beforeEach(async () => {
  query.mockReset();
  query.mockImplementation(() => makeQueryResult());
  const [userId] = await db('users').insert({
    github_id: 3,
    username: 'rev',
    approved: true,
  });
  user = await db('users').where({ id: userId }).first();
  const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
  const claudeConfigId = await insertTestAgentConfig(db, user.id, { apiKey: 'sk-ant-test' });
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  [sessionId] = await db('sessions').insert({
    user_id: user.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    short_id: 'revturn',
    initial_prompt: 't',
    base_branch: 'main',
    local_branch: 'feat/x',
    status: 'stopped',
    session_path: '/tmp/wt',
    agent_sdk: 'claude',
    agent_config_id: claudeConfigId,
    review_agent_config_id: claudeConfigId,
    model: 'sonnet',
  });
  app = makeApp(db);
  await app.setup();
  app.service('sessions').getClaudeEnv = async () => ({});
});

describe('session-review service', () => {
  it('starts a claude review turn without changing session status', async () => {
    const started = await app
      .service('session-review')
      .start(
        { session_id: sessionId, agent_sdk: 'claude', model: 'sonnet', extra_prompt: '' },
        params(user)
      );
    expect(started.ok).toBe(true);

    await vi.waitFor(async () => {
      const row = await db('sessions').where({ id: sessionId }).first();
      expect(row.review_status).toBe('completed');
    });

    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.status).toBe('stopped');

    const msgs = await app.service('messages').find({
      query: { session_id: sessionId, agent_type: 'reviewer', $sort: { id: 1 } },
      ...params(user),
    });
    const rows = msgs.data ?? msgs;
    const firstUser = rows.find((m) => m.type === 'user');
    expect(firstUser).toBeTruthy();
    expect(firstUser.model).toBe('sonnet');
    expect(firstUser.agent_sdk).toBe('claude');
    expect(JSON.parse(firstUser.message_json).source).toBe('baguette');
    expect(rows.some((m) => m.type === 'assistant')).toBe(true);
    expect(query).toHaveBeenCalled();
    const usage = await db('usage').where({ session_id: sessionId, kind: 'review' });
    expect(usage.length).toBe(1);
    expect(usage[0].agent_sdk).toBe('claude');
    expect(Number(usage[0].cost_usd)).toBeCloseTo(0.01);
    expect(usage[0].input_tokens).toBe(10);
    expect(usage[0].output_tokens).toBe(5);
  });

  it('uses review_agent_sdk when it differs from the session sdk', async () => {
    const runTurn = vi.fn(async () => ({ outcome: 'completed', agent: { agentId: 'rev-cursor' } }));
    app.service('cursor-agent').runTurn = runTurn;
    const { insertTestAgentConfig: insertConfig } =
      await import('../../test-utils/agent-configs.js');
    const cursorConfigId = await insertConfig(db, user.id, {
      sdk: 'cursor',
      apiKey: 'cursor-key',
      apiKeyEnvVar: null,
    });
    await db('sessions').where({ id: sessionId }).update({
      agent_sdk: 'claude',
      model: 'sonnet',
      review_agent_config_id: cursorConfigId,
      review_agent_sdk: 'cursor',
      review_model: 'composer',
    });

    await app.service('session-review').start({ session_id: sessionId }, params(user));

    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    expect(runTurn).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    const row = await db('sessions').where({ id: sessionId }).first();
    expect(row.review_agent_sdk).toBe('cursor');
    expect(row.agent_sdk).toBe('claude');
  });

  it('honors agent_sdk from the start request over the session builder sdk', async () => {
    const runTurn = vi.fn(async () => ({ outcome: 'completed', agent: { agentId: 'rev-cursor' } }));
    app.service('cursor-agent').runTurn = runTurn;
    await db('sessions')
      .where({ id: sessionId })
      .update({ agent_sdk: 'cursor', model: 'composer' });

    await app
      .service('session-review')
      .start({ session_id: sessionId, agent_sdk: 'claude', model: 'sonnet' }, params(user));

    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    expect(runTurn).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
    const row = await db('sessions').where({ id: sessionId }).first();
    expect(row.review_agent_sdk).toBe('claude');
    expect(row.review_model).toBe('sonnet');
    expect(row.agent_sdk).toBe('cursor');
  });

  it('persists a human user message when focus text is provided', async () => {
    await app.service('session-review').start(
      {
        session_id: sessionId,
        agent_sdk: 'claude',
        user_message: 'Focus on auth changes',
      },
      params(user)
    );

    await vi.waitFor(async () => {
      const row = await db('sessions').where({ id: sessionId }).first();
      expect(row.review_status).toBe('completed');
    });

    const msgs = await app.service('messages').find({
      query: { session_id: sessionId, agent_type: 'reviewer', $sort: { id: 1 } },
      ...params(user),
    });
    const rows = msgs.data ?? msgs;
    const firstUser = rows.find((m) => m.type === 'user');
    const parsed = JSON.parse(firstUser.message_json);
    expect(parsed.source).toBeUndefined();
    expect(parsed.content).toBe('Focus on auth changes');
    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.review_initial_prompt).toBe('Focus on auth changes');
  });

  it('stores null review_initial_prompt when no focus text is provided', async () => {
    await app.service('session-review').start({ session_id: sessionId }, params(user));
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.review_initial_prompt).toBeNull();
  });

  it('rejects a second concurrent review', async () => {
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    query.mockImplementation(() => {
      const gen = (async function* () {
        await blocked;
        yield {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Looks good' }] },
        };
        yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 };
      })();
      gen.close = vi.fn();
      return gen;
    });

    const first = app
      .service('session-review')
      .start({ session_id: sessionId, agent_sdk: 'claude' }, params(user));
    await vi.waitFor(() => {
      expect(app.service('session-review')._active.has(sessionId)).toBe(true);
    });
    await expect(
      app
        .service('session-review')
        .start({ session_id: sessionId, agent_sdk: 'claude' }, params(user))
    ).rejects.toThrow('review turn is in progress');
    release();
    await first;
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
  });

  it('send queues when a review turn is active', async () => {
    await db('session_messages').insert({
      agent_type: 'reviewer',
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });
    await db('sessions').where({ id: sessionId }).update({ review_status: 'running' });

    const result = await app.service('session-review').send(
      {
        session_id: sessionId,
        message: 'follow up',
        agent_sdk: 'claude',
        model: 'sonnet',
      },
      params(user)
    );
    expect(result).toEqual({ ok: true, queued: true });
    const queued = await db('queued_messages').where({ session_id: sessionId });
    expect(queued).toHaveLength(1);
    expect(queued[0].agent_type).toBe('reviewer');
    expect(queued[0].agent_sdk).toBe('claude');
    expect(queued[0].model).toBe('sonnet');
  });

  it('keeps review_status running until a queued follow-up turn finishes', async () => {
    await db('session_messages').insert({
      agent_type: 'reviewer',
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', content: 'initial review' }),
      turn_id: 1,
    });
    await db('sessions').where({ id: sessionId }).update({
      review_status: 'running',
      review_claude_session_id: 'claude-review-1',
      active_review_turn_id: 1,
      current_turn_id: 1,
    });

    await app.service('session-review').send(
      {
        session_id: sessionId,
        message: 'queued follow-up',
        agent_sdk: 'claude',
        model: 'sonnet',
      },
      params(user)
    );

    const session = await db('sessions').where({ id: sessionId }).first();
    query.mockClear();
    await app.service('session-review').onAgentTurnComplete(session, 'completed');

    const mid = await db('sessions').where({ id: sessionId }).first();
    expect(mid.review_status).toBe('running');
    expect(app.service('session-review')._active.has(sessionId)).toBe(true);
    expect(await db('queued_messages').where({ session_id: sessionId })).toHaveLength(0);

    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    expect(query).toHaveBeenCalled();
    const flushed = await db('session_messages')
      .where({ session_id: sessionId, agent_type: 'reviewer', type: 'user' })
      .orderBy('id', 'asc');
    expect(flushed.some((m) => m.message_json.includes('queued follow-up'))).toBe(true);
    const followUpRow = flushed.find((m) => m.message_json.includes('queued follow-up'));
    expect(followUpRow.turn_id).toBe(1);
  });

  it('send runs a follow-up turn without clearing messages', async () => {
    await db('session_messages').insert({
      agent_type: 'reviewer',
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });
    await db('sessions').where({ id: sessionId }).update({
      review_status: 'completed',
      review_claude_session_id: 'claude-review-1',
    });

    const sent = await app
      .service('session-review')
      .send({ session_id: sessionId, message: 'check again' }, params(user));
    expect(sent.ok).toBe(true);

    await vi.waitFor(async () => {
      const row = await db('sessions').where({ id: sessionId }).first();
      expect(row.review_status).toBe('completed');
    });

    const msgs = await app.service('messages').find({
      query: { session_id: sessionId, agent_type: 'reviewer', $sort: { id: 1 } },
      ...params(user),
    });
    const rows = msgs.data ?? msgs;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((m) => m.message_json?.includes('check again'))).toBe(true);
    expect(query).toHaveBeenCalled();
    const callOptions = query.mock.calls.at(-1)?.[0]?.options;
    expect(callOptions?.resume).toBe('claude-review-1');
  });

  it('start replaces the previous review thread', async () => {
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'first pass' }, params(user));
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    const first = await db('session_messages').where({
      session_id: sessionId,
      agent_type: 'reviewer',
    });
    expect(first.some((m) => m.message_json?.includes('first pass'))).toBe(true);

    await vi.waitFor(() => {
      expect(app.service('session-review')._active.has(sessionId)).toBe(false);
    });
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'second pass' }, params(user));
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    const second = await db('session_messages').where({
      session_id: sessionId,
      agent_type: 'reviewer',
    });
    expect(second.some((m) => m.message_json?.includes('first pass'))).toBe(false);
    expect(second.some((m) => m.message_json?.includes('second pass'))).toBe(true);
  });

  it('resumes an interrupted review that has a stored agent id', async () => {
    await db('session_messages').insert({
      agent_type: 'reviewer',
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });
    await db('sessions').where({ id: sessionId }).update({
      review_status: 'running',
      review_agent_sdk: 'claude',
      review_claude_session_id: 'claude-review-resume',
    });

    const result = await app.service('session-review').resumeInterrupted();
    expect(result).toEqual({ resumed: 1, failed: 0 });

    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    const callOptions = query.mock.calls.at(-1)?.[0]?.options;
    expect(callOptions?.resume).toBe('claude-review-resume');
    const msgs = await db('session_messages').where({
      session_id: sessionId,
      agent_type: 'reviewer',
    });
    expect(msgs.some((m) => m.message_json?.includes('Server restarted'))).toBe(true);
  });

  it('fails an interrupted review with no stored agent id', async () => {
    await db('sessions').where({ id: sessionId }).update({
      review_status: 'running',
      review_agent_sdk: 'claude',
      review_claude_session_id: null,
    });
    const result = await app.service('session-review').resumeInterrupted();
    expect(result).toEqual({ resumed: 0, failed: 1 });
    expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe('failed');
  });

  it('does not set last_reviewed_commit_sha until the review turn completes', async () => {
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    query.mockImplementation(() => {
      const gen = (async function* () {
        await blocked;
        yield {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        };
        yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 };
      })();
      gen.close = vi.fn();
      return gen;
    });
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt });
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'pass' }, params(user));
    await vi.waitFor(() => {
      expect(app.service('session-review')._active.has(sessionId)).toBe(true);
    });
    expect(
      (await db('sessions').where({ id: sessionId }).first()).last_reviewed_commit_sha
    ).toBeNull();
    release();
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    query.mockImplementation(() => makeQueryResult());
    await fs.promises.rm(wt, { recursive: true, force: true });
  });

  it('send updates last_reviewed_commit_sha after new commits', async () => {
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt });
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'first' }, params(user));
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    const firstReviewed = (await db('sessions').where({ id: sessionId }).first())
      .last_reviewed_commit_sha;
    await git(wt, 'commit', '--allow-empty', '-m', 'second');

    await app
      .service('session-review')
      .send({ session_id: sessionId, message: 'check the latest commit' }, params(user));
    await vi.waitFor(async () => {
      const row = await db('sessions').where({ id: sessionId }).first();
      expect(row.review_status).toBe('completed');
      expect(row.last_reviewed_commit_sha).not.toBe(firstReviewed);
    });

    const session = await db('sessions').where({ id: sessionId }).first();
    const head = await gitRevParseShort(wt, 'HEAD');
    expect(session.last_reviewed_commit_sha).toBe(head);
    await fs.promises.rm(wt, { recursive: true, force: true });
  });

  it('clearContext wipes review messages and agent ids', async () => {
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'pass' }, params(user));
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    const cleared = await app
      .service('session-review')
      .clearContext({ session_id: sessionId }, params(user));
    expect(cleared.ok).toBe(true);
    const rows = await db('session_messages').where({
      session_id: sessionId,
      agent_type: 'reviewer',
    });
    expect(rows.length).toBe(0);
    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.review_claude_session_id).toBeNull();
    expect(session.review_cursor_agent_id).toBeNull();
    expect(session.review_status).toBeNull();
    expect(session.last_reviewed_commit_sha).toBeNull();
    expect(session.review_initial_prompt).toBeNull();
  });

  it('reviewNewCommits persists a baguette-labelled user message', async () => {
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt });
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'first' }, params(user));
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    await git(wt, 'commit', '--allow-empty', '-m', 'second');

    await app.service('session-review').reviewNewCommits({ session_id: sessionId }, params(user));
    const rows = await db('session_messages')
      .where({ session_id: sessionId, type: 'user', agent_type: 'reviewer' })
      .orderBy('id', 'desc');
    const latest = JSON.parse(rows[0].message_json);
    expect(latest.source).toBe('baguette');
    expect(latest.title).toBe('Review latest changes');
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    await fs.promises.rm(wt, { recursive: true, force: true });
  });

  it('reviewNewCommits appends user_message to the review prompt', async () => {
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt });
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'first' }, params(user));
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });

    await app
      .service('session-review')
      .reviewNewCommits(
        { session_id: sessionId, user_message: 'check auth middleware' },
        params(user)
      );
    const rows = await db('session_messages')
      .where({ session_id: sessionId, type: 'user', agent_type: 'reviewer' })
      .orderBy('id', 'desc');
    const latest = JSON.parse(rows[0].message_json);
    expect(latest.content).toMatch(/Additional instructions:/);
    expect(latest.content).toMatch(/check auth middleware/);
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    await fs.promises.rm(wt, { recursive: true, force: true });
  });

  it('reviewNewCommits allows a follow-up with no new commits', async () => {
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt });
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'first' }, params(user));
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });

    await app.service('session-review').reviewNewCommits({ session_id: sessionId }, params(user));
    const rows = await db('session_messages')
      .where({ session_id: sessionId, type: 'user', agent_type: 'reviewer' })
      .orderBy('id', 'desc');
    const latest = JSON.parse(rows[0].message_json);
    expect(latest.title).toBe('Review latest changes');
    expect(latest.content).toMatch(/uncommitted work/);
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    await fs.promises.rm(wt, { recursive: true, force: true });
  });

  it('reviewNewCommits uses the base branch when the commit marker is unset', async () => {
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    query.mockImplementation(() => {
      const gen = (async function* () {
        await blocked;
        yield {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        };
        yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 };
      })();
      gen.close = vi.fn();
      return gen;
    });
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt, base_branch: 'main' });
    await app
      .service('session-review')
      .start({ session_id: sessionId, user_message: 'first' }, params(user));
    await vi.waitFor(() => {
      expect(app.service('session-review')._active.has(sessionId)).toBe(true);
    });
    await app.service('session-review').stop({ session_id: sessionId }, params(user));
    release();
    expect(
      (await db('sessions').where({ id: sessionId }).first()).last_reviewed_commit_sha
    ).toBeNull();

    query.mockImplementation(() => makeQueryResult());
    await app.service('session-review').reviewNewCommits({ session_id: sessionId }, params(user));
    const rows = await db('session_messages')
      .where({ session_id: sessionId, type: 'user', agent_type: 'reviewer' })
      .orderBy('id', 'desc');
    const latest = JSON.parse(rows[0].message_json);
    expect(latest.title).toBe('Review latest changes');
    expect(latest.content).toMatch(/base branch `main`/);
    expect(latest.content).toMatch(/git diff main\.\.\.HEAD/);
    await vi.waitFor(async () => {
      expect((await db('sessions').where({ id: sessionId }).first()).review_status).toBe(
        'completed'
      );
    });
    await vi.waitFor(() => {
      expect(app.service('session-review')._active.has(sessionId)).toBe(false);
    });
    await fs.promises.rm(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('clearContext rejects while a review turn is active', async () => {
    await db('session_messages').insert({
      agent_type: 'reviewer',
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });
    app.service('session-review')._active.set(sessionId, { pending: true });

    await expect(
      app.service('session-review').clearContext({ session_id: sessionId }, params(user))
    ).rejects.toThrow('review turn is in progress');
  });
});
