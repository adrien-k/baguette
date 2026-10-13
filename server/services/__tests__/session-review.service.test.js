import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createTestDb } from '../../test-utils/db.js';
import {
  insertSessionWithPrimaryBuilder,
  reviewerStatusForSession,
} from '../../test-utils/session-agents.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionIssuesService } from '../feathers/session-issues.service.js';
import { getReviewAgentTurn, registerReviewAgentTurn } from '../review-agent-turn.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
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

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });
const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  await execFileAsync('git', ['-C', cwd, ...args]);
}

async function removeGitWorktree(dir) {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
        await getReviewAgentTurn(app).onAgentTurnComplete(session, outcome, {
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
  registerReviewAgentTurn(app);
  registerAgentsService(app);
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

async function upsertReviewerAgent(overrides = {}) {
  const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
  const existing = await db('agents')
    .where({ session_id: sessionId, agent_type: 'reviewer' })
    .first();
  const payload = {
    session_id: sessionId,
    name: 'Reviewer',
    agent_type: 'reviewer',
    is_primary: 0,
    status: 'stopped',
    agent_config_id: builder?.agent_config_id ?? null,
    agent_sdk: builder?.agent_sdk ?? 'claude',
    model: builder?.model ?? 'sonnet',
    current_turn_id: 0,
    claude_session_id: null,
    active_turn_id: null,
    ...overrides,
  };
  if (existing) {
    await db('agents').where({ id: existing.id }).update(payload);
    return existing.id;
  }
  const [id] = await db('agents').insert(payload);
  return id;
}

async function primaryBuilderRow() {
  return db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
}

async function createReviewer(overrides = {}) {
  const builder = await primaryBuilderRow();
  const {
    user_message,
    review_agent_config_id,
    session_id: _sid,
    extra_prompt,
    ...rest
  } = overrides;
  const payload = {
    session_id: sessionId,
    agent_type: 'reviewer',
    agent_config_id: review_agent_config_id ?? rest.agent_config_id ?? builder.agent_config_id,
    model: rest.model ?? builder.model ?? 'sonnet',
    initial_prompt: user_message ?? rest.initial_prompt ?? null,
    extra_prompt,
    ...rest,
  };
  return app.service('agents').create(payload, params(user));
}

async function reviewerRow() {
  return db('agents').where({ session_id: sessionId, agent_type: 'reviewer' }).first();
}

async function reviewerMessagesQuery(extra = {}) {
  const rev = await reviewerRow();
  return { session_id: sessionId, agent_id: rev.id, ...extra };
}

async function reviewerMessageRow(fields = {}) {
  const rev = await reviewerRow();
  if (!rev) throw new Error('reviewer agent missing');
  return {
    session_id: sessionId,
    agent_id: rev.id,
    agent_sdk: rev.agent_sdk ?? 'claude',
    model: rev.model ?? 'sonnet',
    ...fields,
  };
}

async function sendReviewMessage(message, overrides = {}) {
  const rev = await reviewerRow();
  const builder = await primaryBuilderRow();
  return app.service('messages').create(
    {
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', content: message }),
      agent_id: rev.id,
      agent_sdk: overrides.agent_sdk ?? rev.agent_sdk ?? 'claude',
      model: overrides.model ?? rev.model ?? 'sonnet',
      agent_config_id:
        overrides.review_agent_config_id ?? rev.agent_config_id ?? builder.agent_config_id,
    },
    params(user)
  );
}

async function reviewLatestCommits(overrides = {}) {
  const { buildReviewLatestChangesContent, BAGUETTE_REVIEW_LATEST_TITLE } =
    await import('../../../shared/review-latest-changes-prompt.js');
  const session = await db('sessions').where({ id: sessionId }).first();
  const rev = await reviewerRow();
  let content = buildReviewLatestChangesContent(session.base_branch);
  if (overrides.user_message) {
    content = `${content}\n\nAdditional instructions:\n${overrides.user_message}`;
  }
  return app.service('messages').create(
    {
      session_id: sessionId,
      type: 'user',
      subtype: 'baguette',
      message_json: JSON.stringify({
        type: 'user',
        subtype: 'baguette',
        source: 'baguette',
        title: BAGUETTE_REVIEW_LATEST_TITLE,
        content,
      }),
      agent_id: rev.id,
      agent_type: 'reviewer',
      agent_sdk: rev.agent_sdk,
      model: rev.model,
      agent_config_id: rev.agent_config_id,
    },
    params(user)
  );
}

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
  sessionId = await insertSessionWithPrimaryBuilder(db, {
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
    model: 'sonnet',
  });
  app = makeApp(db);
  await app.setup();
  app.service('sessions').getClaudeEnv = async () => ({});
});

describe('session-review service', () => {
  it('starts a claude review turn without changing session status', async () => {
    await createReviewer({ agent_sdk: 'claude', model: 'sonnet', extra_prompt: '' });

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });

    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.status).toBe('stopped');

    const msgs = await app.service('messages').find({
      query: { ...(await reviewerMessagesQuery({ $sort: { id: 1 } })) },
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
    const usage = await db('usage').where({ session_id: sessionId, agent_type: 'reviewer' });
    expect(usage.length).toBe(1);
    expect(usage[0].agent_sdk).toBe('claude');
    expect(Number(usage[0].cost_usd)).toBeCloseTo(0.01, 6);
    expect(usage[0].input_tokens).toBe(10);
    expect(usage[0].output_tokens).toBe(5);
  });

  it('snapshots the review model and config on reviewer rows instead of the builder ones', async () => {
    const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
    const reviewerId = await insertTestAgentConfig(db, user.id, {
      apiKey: 'sk-reviewer',
      label: 'Review Claude',
    });
    await createReviewer({
      review_agent_config_id: reviewerId,
      agent_sdk: 'claude',
      model: 'review-claude-4-5',
    });

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    const msgs = await app.service('messages').find({
      query: { ...(await reviewerMessagesQuery({ $sort: { id: 1 } })) },
      ...params(user),
    });
    const firstUser = (msgs.data ?? msgs).find((m) => m.type === 'user');
    expect(firstUser.model).toBe('review-claude-4-5');
    expect(firstUser.agent_sdk).toBe('claude');
    expect(firstUser.agent_config_id).toBe(reviewerId);
    // The turn runs the row's snapshots — the reviewer's model and credentials —
    // not the builder's.
    expect(query.mock.calls[0][0].options.model).toBe('review-claude-4-5');
    expect(query.mock.calls[0][0].options.env.ANTHROPIC_API_KEY).toBe('sk-reviewer');
    const usage = await db('usage').where({ session_id: sessionId, agent_type: 'reviewer' });
    expect(usage[0].agent_config_id).toBe(reviewerId);
  });

  it('runs the review on the message row config even when the review_agent_config_id payload differs from the session', async () => {
    const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
    const reviewerId = await insertTestAgentConfig(db, user.id, {
      apiKey: 'sk-reviewer',
      label: 'Review Claude',
    });

    await createReviewer({ review_agent_config_id: reviewerId });

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    const reviewer = await db('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    expect(reviewer.agent_config_id).toBe(reviewerId);
    expect(query.mock.calls[0][0].options.env.ANTHROPIC_API_KEY).toBe('sk-reviewer');
    const usage = await db('usage').where({ session_id: sessionId, agent_type: 'reviewer' });
    expect(usage[0].agent_config_id).toBe(reviewerId);
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
    await db('agents').where({ session_id: sessionId, is_primary: 1 }).update({
      agent_sdk: 'claude',
      model: 'sonnet',
    });
    await createReviewer({
      agent_config_id: cursorConfigId,
      agent_sdk: 'cursor',
      model: 'composer',
    });

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    expect(runTurn).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    const reviewer = await db('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    expect(reviewer.agent_sdk).toBe('cursor');
    expect(builder.agent_sdk).toBe('claude');
  });

  it('honors agent_sdk from the start request over the session builder sdk', async () => {
    const runTurn = vi.fn(async () => ({ outcome: 'completed', agent: { agentId: 'rev-cursor' } }));
    app.service('cursor-agent').runTurn = runTurn;
    await db('agents').where({ session_id: sessionId, is_primary: 1 }).update({
      agent_sdk: 'cursor',
      model: 'composer',
    });

    await createReviewer({ agent_sdk: 'claude', model: 'sonnet' });

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    expect(runTurn).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
    const reviewer = await db('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    expect(reviewer.agent_sdk).toBe('claude');
    expect(reviewer.model).toBe('sonnet');
    expect(builder.agent_sdk).toBe('cursor');
  });

  it('persists a human user message when focus text is provided', async () => {
    await createReviewer({
      agent_sdk: 'claude',
      user_message: 'Focus on auth changes',
    });

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });

    const msgs = await app.service('messages').find({
      query: { ...(await reviewerMessagesQuery({ $sort: { id: 1 } })) },
      ...params(user),
    });
    const rows = msgs.data ?? msgs;
    const firstUser = rows.find((m) => m.type === 'user');
    const parsed = JSON.parse(firstUser.message_json);
    expect(parsed.source).toBeUndefined();
    expect(parsed.content).toBe('Focus on auth changes');
    const reviewer = await db('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    expect(reviewer.initial_prompt).toBe('Focus on auth changes');
  });

  it('stores null review_initial_prompt when no focus text is provided', async () => {
    await createReviewer();
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    const reviewer = await db('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    expect(reviewer.initial_prompt).toBeNull();
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

    const first = createReviewer({ agent_sdk: 'claude' });
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('running');
    });
    await expect(createReviewer({ agent_sdk: 'claude' })).rejects.toThrow(
      'Session already has a reviewer'
    );
    release();
    await first;
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
  });

  it('send queues when a review turn is active', async () => {
    await upsertReviewerAgent({ status: 'running' });
    await db('session_messages').insert(
      await reviewerMessageRow({
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      })
    );

    const result = await sendReviewMessage('follow up', { agent_sdk: 'claude', model: 'sonnet' });
    expect(result).toEqual({ queued: true });
    const queued = await db('queued_messages').where({ session_id: sessionId });
    expect(queued).toHaveLength(1);
    expect(queued[0].agent_id).toBe((await reviewerRow()).id);
    expect(queued[0].agent_sdk).toBe('claude');
    expect(queued[0].model).toBe('sonnet');
  });

  it('keeps review_status running until a queued follow-up turn finishes', async () => {
    await upsertReviewerAgent({
      status: 'running',
      claude_session_id: 'claude-review-1',
      active_turn_id: 1,
      current_turn_id: 1,
    });
    await db('session_messages').insert(
      await reviewerMessageRow({
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'initial review' }),
        turn_id: 1,
      })
    );

    await sendReviewMessage('queued follow-up', { agent_sdk: 'claude', model: 'sonnet' });

    const session = await db('sessions').where({ id: sessionId }).first();
    query.mockClear();
    await getReviewAgentTurn(app).onAgentTurnComplete(session, 'completed');

    expect(await reviewerStatusForSession(db, sessionId)).toBe('running');
    expect(await db('queued_messages').where({ session_id: sessionId })).toHaveLength(0);

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    expect(query).toHaveBeenCalled();
    const rev = await reviewerRow();
    const flushed = await db('session_messages')
      .where({ session_id: sessionId, agent_id: rev.id, type: 'user' })
      .orderBy('id', 'asc');
    expect(flushed.some((m) => m.message_json.includes('queued follow-up'))).toBe(true);
    const followUpRow = flushed.find((m) => m.message_json.includes('queued follow-up'));
    expect(followUpRow.turn_id).toBe(2);
  });

  it('send runs a follow-up turn without clearing messages', async () => {
    await upsertReviewerAgent({
      status: 'completed',
      claude_session_id: 'claude-review-1',
    });
    await db('session_messages').insert(
      await reviewerMessageRow({
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      })
    );

    await sendReviewMessage('check again');

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });

    const msgs = await app.service('messages').find({
      query: { ...(await reviewerMessagesQuery({ $sort: { id: 1 } })) },
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
    await createReviewer({ user_message: 'first pass' });
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    const revAfterFirst = await reviewerRow();
    const first = await db('session_messages').where({
      session_id: sessionId,
      agent_id: revAfterFirst.id,
    });
    expect(first.some((m) => m.message_json?.includes('first pass'))).toBe(true);

    const existing = await reviewerRow();
    await app.service('agents').remove(existing.id, params(user));
    await createReviewer({ user_message: 'second pass' });
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    const revAfterSecond = await reviewerRow();
    const second = await db('session_messages').where({
      session_id: sessionId,
      agent_id: revAfterSecond.id,
    });
    expect(second.some((m) => m.message_json?.includes('first pass'))).toBe(false);
    expect(second.some((m) => m.message_json?.includes('second pass'))).toBe(true);
  });

  it('resumes an interrupted review that has a stored agent id', async () => {
    await upsertReviewerAgent({
      status: 'running',
      agent_sdk: 'claude',
      claude_session_id: 'claude-review-resume',
    });
    await db('session_messages').insert(
      await reviewerMessageRow({
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      })
    );

    const result = await getReviewAgentTurn(app).resumeInterrupted();
    expect(result).toEqual({ resumed: 1, failed: 0 });

    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    const callOptions = query.mock.calls.at(-1)?.[0]?.options;
    expect(callOptions?.resume).toBe('claude-review-resume');
    const rev = await reviewerRow();
    const msgs = await db('session_messages').where({
      session_id: sessionId,
      agent_id: rev.id,
    });
    expect(msgs.some((m) => m.message_json?.includes('Server restarted'))).toBe(true);
  });

  it('fails an interrupted review with no stored agent id', async () => {
    await upsertReviewerAgent({
      status: 'running',
      agent_sdk: 'claude',
      claude_session_id: null,
    });
    const result = await getReviewAgentTurn(app).resumeInterrupted();
    expect(result).toEqual({ resumed: 0, failed: 1 });
    expect(await reviewerStatusForSession(db, sessionId)).toBe('failed');
  });

  it('remove clears the reviewer agent and its messages', async () => {
    await createReviewer({ user_message: 'pass' });
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    const reviewer = await reviewerRow();
    const reviewerId = reviewer.id;
    await app.service('agents').remove(reviewer.id, params(user));
    const rows = await db('session_messages').where({
      session_id: sessionId,
      agent_id: reviewerId,
    });
    expect(rows.length).toBe(0);
    expect(await reviewerRow()).toBeUndefined();
  });

  it('review latest changes persists a baguette-labelled user message', async () => {
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt });
    await createReviewer({ user_message: 'first' });
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    await git(wt, 'commit', '--allow-empty', '-m', 'second');

    await reviewLatestCommits();
    const rev = await reviewerRow();
    const rows = await db('session_messages')
      .where({ session_id: sessionId, type: 'user', agent_id: rev.id })
      .orderBy('id', 'desc');
    const latest = JSON.parse(rows[0].message_json);
    expect(latest.source).toBe('baguette');
    expect(latest.title).toBe('Review latest changes');
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    await removeGitWorktree(wt);
  });

  it('review latest changes appends user_message to the prompt', async () => {
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt });
    await createReviewer({ user_message: 'first' });
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });

    await reviewLatestCommits({ user_message: 'check auth middleware' });
    const rev = await reviewerRow();
    const rows = await db('session_messages')
      .where({ session_id: sessionId, type: 'user', agent_id: rev.id })
      .orderBy('id', 'desc');
    const latest = JSON.parse(rows[0].message_json);
    expect(latest.content).toMatch(/Additional instructions:/);
    expect(latest.content).toMatch(/check auth middleware/);
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    await removeGitWorktree(wt);
  });

  it('review latest changes allows a follow-up with no new commits', async () => {
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt });
    await createReviewer({ user_message: 'first' });
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });

    await reviewLatestCommits();
    const rev = await reviewerRow();
    const rows = await db('session_messages')
      .where({ session_id: sessionId, type: 'user', agent_id: rev.id })
      .orderBy('id', 'desc');
    const latest = JSON.parse(rows[0].message_json);
    expect(latest.title).toBe('Review latest changes');
    expect(latest.content).toMatch(/uncommitted work/);
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    await removeGitWorktree(wt);
  });

  it('review latest changes uses the session base branch in the prompt', async () => {
    const wt = await initGitWorktree();
    await db('sessions').where({ id: sessionId }).update({ session_path: wt, base_branch: 'main' });
    await createReviewer({ user_message: 'first' });
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });

    await reviewLatestCommits();
    const rev = await reviewerRow();
    const rows = await db('session_messages')
      .where({ session_id: sessionId, type: 'user', agent_id: rev.id })
      .orderBy('id', 'desc');
    const latest = JSON.parse(rows[0].message_json);
    expect(latest.title).toBe('Review latest changes');
    expect(latest.content).toMatch(/base branch `main`/);
    expect(latest.content).toMatch(/git diff main\.\.\.HEAD/);
    await vi.waitFor(async () => {
      expect(await reviewerStatusForSession(db, sessionId)).toBe('completed');
    });
    await removeGitWorktree(wt);
  });

  it('remove stops a running reviewer before deleting', async () => {
    await upsertReviewerAgent({ status: 'running' });
    const reviewer = await reviewerRow();
    await app.service('agents').remove(reviewer.id, params(user));
    expect(await reviewerRow()).toBeUndefined();
  });
});
