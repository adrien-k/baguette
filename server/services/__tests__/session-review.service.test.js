import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createTestDb } from '../../test-utils/db.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionIssuesService } from '../feathers/session-issues.service.js';
import { registerSessionReviewMessagesService } from '../feathers/session-review-messages.service.js';
import { registerSessionReviewService } from '../feathers/session-review.service.js';
import { registerClaudeAgentService } from '../feathers/claude-agent.service.js';

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

function makeQueryResult() {
  const gen = reviewStream();
  gen.close = vi.fn();
  return gen;
}

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerClaudeAgentService(app);
  app.use(
    'cursor-agent',
    {
      onMessageCreated: async () => {},
      stopTurn: async () => {},
      runTurn: async () => ({ outcome: 'completed', agent: { agentId: 'rev-cursor' } }),
      buildAgentOptions: async () => ({}),
      writeAlwaysApplyRule: async () => {},
      recordTurnUsage: async () => {},
    },
    {
      methods: [
        'onMessageCreated',
        'stopTurn',
        'runTurn',
        'buildAgentOptions',
        'writeAlwaysApplyRule',
        'recordTurnUsage',
      ],
    }
  );
  registerMessagesService(app);
  registerSessionIssuesService(app);
  registerSessionReviewMessagesService(app);
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
  const [userId] = await db('users').insert({ github_id: 3, username: 'rev', approved: true });
  user = await db('users').where({ id: userId }).first();
  const [repoId] = await db('repos').insert({ full_name: 'o/r', bare_path: '/tmp/r' });
  [sessionId] = await db('sessions').insert({
    user_id: user.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    short_id: 'revturn',
    initial_prompt: 't',
    base_branch: 'main',
    created_branch: 'feat/x',
    status: 'stopped',
    worktree_path: '/tmp/wt',
    agent_sdk: 'claude',
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

    const msgs = await app.service('session-review-messages').find({
      query: { session_id: sessionId, $sort: { id: 1 } },
      ...params(user),
    });
    const rows = msgs.data ?? msgs;
    const firstUser = rows.find((m) => m.type === 'user');
    expect(firstUser).toBeTruthy();
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

  it('uses the session sdk even if start requests a different one', async () => {
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
    expect(runTurn).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    const row = await db('sessions').where({ id: sessionId }).first();
    expect(row.review_agent_sdk).toBe('cursor');
    expect(row.review_model).toBe('sonnet');
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

    const msgs = await app.service('session-review-messages').find({
      query: { session_id: sessionId, $sort: { id: 1 } },
      ...params(user),
    });
    const rows = msgs.data ?? msgs;
    const firstUser = rows.find((m) => m.type === 'user');
    const parsed = JSON.parse(firstUser.message_json);
    expect(parsed.source).toBeUndefined();
    expect(parsed.message.content).toBe('Focus on auth changes');
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

  it('send rejects when a review turn is active in memory', async () => {
    await db('session_review_messages').insert({
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    });
    await db('sessions').where({ id: sessionId }).update({ review_status: 'completed' });
    app.service('session-review')._active.set(sessionId, { pending: true });

    await expect(
      app
        .service('session-review')
        .send({ session_id: sessionId, message: 'follow up' }, params(user))
    ).rejects.toThrow('review turn is in progress');
  });

  it('send runs a follow-up turn without clearing messages', async () => {
    await db('session_review_messages').insert({
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

    const msgs = await app.service('session-review-messages').find({
      query: { session_id: sessionId, $sort: { id: 1 } },
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
    const first = await db('session_review_messages').where({ session_id: sessionId });
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
    const second = await db('session_review_messages').where({ session_id: sessionId });
    expect(second.some((m) => m.message_json?.includes('first pass'))).toBe(false);
    expect(second.some((m) => m.message_json?.includes('second pass'))).toBe(true);
  });

  it('resumes an interrupted review that has a stored agent id', async () => {
    await db('session_review_messages').insert({
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
    const msgs = await db('session_review_messages').where({ session_id: sessionId });
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
    const rows = await db('session_review_messages').where({ session_id: sessionId });
    expect(rows.length).toBe(0);
    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.review_claude_session_id).toBeNull();
    expect(session.review_cursor_agent_id).toBeNull();
    expect(session.review_status).toBe('stopped');
  });

  it('clearContext rejects while a review turn is active', async () => {
    await db('session_review_messages').insert({
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
