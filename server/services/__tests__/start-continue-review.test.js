import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createTestDb } from '../../test-utils/db.js';
import { insertSessionWithPrimaryBuilder } from '../../test-utils/session-agents.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerReviewAgentTurn } from '../review-agent-turn.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { mountAgentConfigs } from '../../test-utils/agent-sdks.js';
import { registerAgentSdk, registerSdkPlugin } from '../../agent-sdks/registry.js';
import { claudeAgentSdkPlugin } from '../../agent-sdks/claude/index.js';
import { clearAllUsageTotals } from '../../agent-sdks/claude/usage-totals.js';
import { createStartReviewTool } from '../mcp/tools/start-review.js';
import { createContinueReviewTool } from '../mcp/tools/continue-review.js';
import { createSessionAgentContext } from '../mcp/lib/session-agent-context.js';
import { MCP_REVIEWER_MODEL_SETTINGS_ERROR } from '../agent-mcp-model-resolver.js';

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

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

function payload(result) {
  return JSON.parse(result.content[0].text);
}

function makeQueryResult() {
  const gen = (async function* () {
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    };
    yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 };
  })();
  gen.close = vi.fn();
  return gen;
}

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerSessionsService(app);
  app.use('users', { get: async (id) => ({ id, access_token: 'tok' }) }, { methods: ['get'] });
  registerMessagesService(app);
  registerQueuedMessagesService(app);
  mountAgentConfigs(app);
  claudeAgentSdkPlugin.register(app);
  registerAgentSdk(app, { key: 'cursor', label: 'Cursor', servicePath: 'cursor-agent' });
  registerSdkPlugin(claudeAgentSdkPlugin);
  registerReviewAgentTurn(app);
  registerAgentsService(app);
  return app;
}

let app;
let user;
let sessionId;
let sessionRow;
let claudeConfigId;

beforeEach(async () => {
  clearAllUsageTotals();
  query.mockReset();
  query.mockImplementation(() => makeQueryResult());
  await db('session_messages').delete();
  await db('agents').delete();
  await db('sessions').delete();
  await db('users').delete();
  const [userId] = await db('users').insert({
    github_id: 90,
    username: 'review-mcp',
    status: 'approved',
    reviewer_default_config_id: null,
    reviewer_default_model: null,
  });
  user = await db('users').where({ id: userId }).first();
  const { insertTestAgentConfig } = await import('../../test-utils/agent-configs.js');
  claudeConfigId = await insertTestAgentConfig(db, user.id, { apiKey: 'sk-ant-test' });
  const [repoId] = await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
  sessionId = await insertSessionWithPrimaryBuilder(db, {
    user_id: user.id,
    repo_id: repoId,
    repo_full_name: 'o/r',
    short_id: 'revMcp',
    initial_prompt: 't',
    base_branch: 'main',
    local_branch: 'feat/x',
    status: 'stopped',
    session_path: '/tmp/wt',
    agent_sdk: 'claude',
    agent_config_id: claudeConfigId,
    model: 'sonnet',
  });
  sessionRow = await db('sessions').where({ id: sessionId }).first();
  app = makeApp();
  await app.setup();
  app.service('sessions').getClaudeEnv = async () => ({});
});

async function setReviewerDefaults() {
  await db('users')
    .where({ id: user.id })
    .update({
      reviewer_default_config_id: claudeConfigId,
      reviewer_default_model: JSON.stringify({ model: 'sonnet', model_params: null }),
    });
}

function mcpCtx() {
  return createSessionAgentContext(sessionRow, app);
}

describe('agents.startReview / continueReview', () => {
  it('rejects start when reviewer defaults are not configured', async () => {
    await expect(
      app.service('agents').startReview({ session_id: sessionId }, params(user))
    ).rejects.toThrow(MCP_REVIEWER_MODEL_SETTINGS_ERROR);
  });

  it('starts a review using account reviewer defaults', async () => {
    await setReviewerDefaults();
    const result = await app
      .service('agents')
      .startReview({ session_id: sessionId, initial_prompt: 'focus auth' }, params(user));
    expect(result.ok).toBe(true);
    expect(result.agent_id).toBeGreaterThan(0);
    const reviewer = await db('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    expect(reviewer.model).toBe('sonnet');
    expect(reviewer.initial_prompt).toBe('focus auth');
    await vi.waitFor(async () => {
      const fresh = await db('agents').where({ id: reviewer.id }).first();
      expect(fresh.status).toBe('completed');
    });
  });

  it('rejects start when a reviewer already exists', async () => {
    await setReviewerDefaults();
    await app.service('agents').startReview({ session_id: sessionId }, params(user));
    await vi.waitFor(async () => {
      const r = await db('agents').where({ session_id: sessionId, agent_type: 'reviewer' }).first();
      expect(r.status).toBe('completed');
    });
    await expect(
      app.service('agents').startReview({ session_id: sessionId }, params(user))
    ).rejects.toThrow('Session already has a reviewer');
  });

  it('rejects start and continue while a review is running', async () => {
    await setReviewerDefaults();
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    query.mockImplementation(() => {
      const gen = (async function* () {
        await blocked;
        yield {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        };
        yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 };
      })();
      gen.close = vi.fn();
      return gen;
    });
    const pending = app.service('agents').startReview({ session_id: sessionId }, params(user));
    await vi.waitFor(async () => {
      const r = await db('agents').where({ session_id: sessionId, agent_type: 'reviewer' }).first();
      expect(r?.status).toBe('running');
    });
    await expect(
      app.service('agents').startReview({ session_id: sessionId }, params(user))
    ).rejects.toThrow('A review is already in progress');
    await expect(
      app.service('agents').continueReview({ session_id: sessionId }, params(user))
    ).rejects.toThrow('A review is already in progress');
    release();
    await pending;
  });

  it('clear_previous_review removes an idle reviewer before starting', async () => {
    await setReviewerDefaults();
    const first = await app.service('agents').startReview({ session_id: sessionId }, params(user));
    await vi.waitFor(async () => {
      const r = await db('agents').where({ id: first.agent_id }).first();
      expect(r.status).toBe('completed');
    });
    const second = await app
      .service('agents')
      .startReview(
        { session_id: sessionId, clear_previous_review: true, initial_prompt: 'second' },
        params(user)
      );
    expect(second.cleared_previous_reviewer).toBe(true);
    expect(second.agent_id).not.toBe(first.agent_id);
    const msgs = await db('session_messages').where({
      session_id: sessionId,
      agent_id: second.agent_id,
    });
    expect(msgs.length).toBeGreaterThan(0);
    const oldMsgs = await db('session_messages').where({ agent_id: first.agent_id });
    expect(oldMsgs).toHaveLength(0);
  });

  it('continueReview requires an existing reviewer', async () => {
    await expect(
      app.service('agents').continueReview({ session_id: sessionId }, params(user))
    ).rejects.toThrow('Start a review first');
  });

  it('startReview notify_parent inserts an observer row', async () => {
    await setReviewerDefaults();
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const result = await app
      .service('agents')
      .startReview(
        { session_id: sessionId, notify_parent: true, observer_agent_id: builder.id },
        params(user)
      );
    expect(result.notify_parent).toBe(true);
    const row = await db('agent_observers')
      .where({ agent_id: result.agent_id, observer_agent_id: builder.id })
      .first();
    expect(row).toBeTruthy();
    expect(row.notify_on).toBe('once');
  });

  it('rejects review notify_parent when observer is in a different repo session', async () => {
    await setReviewerDefaults();
    const otherSessionId = await insertSessionWithPrimaryBuilder(db, {
      user_id: user.id,
      repo_id: sessionRow.repo_id,
      repo_full_name: 'o/r',
      short_id: 'revOth',
      initial_prompt: 'other',
      base_branch: 'main',
      local_branch: 'feat/y',
      status: 'stopped',
      session_path: '/tmp/wt2',
      agent_sdk: 'claude',
      agent_config_id: claudeConfigId,
      model: 'sonnet',
    });
    const otherBuilder = await db('agents')
      .where({ session_id: otherSessionId, is_primary: 1 })
      .first();
    await expect(
      app.service('agents').startReview(
        {
          session_id: sessionId,
          notify_parent: true,
          observer_agent_id: otherBuilder.id,
        },
        params(user)
      )
    ).rejects.toThrow('Review notify_parent only allows');
  });

  it('continueReview notify_parent inserts an observer row', async () => {
    await setReviewerDefaults();
    const start = await app.service('agents').startReview({ session_id: sessionId }, params(user));
    await vi.waitFor(async () => {
      const r = await db('agents').where({ id: start.agent_id }).first();
      expect(r.status).toBe('completed');
    });
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const result = await app
      .service('agents')
      .continueReview(
        { session_id: sessionId, notify_parent: true, observer_agent_id: builder.id },
        params(user)
      );
    expect(result.notify_parent).toBe(true);
    const row = await db('agent_observers')
      .where({ agent_id: result.agent_id, observer_agent_id: builder.id })
      .first();
    expect(row).toBeTruthy();
    expect(row.notify_on).toBe('once');
    await vi.waitFor(async () => {
      const reviewer = await db('agents').where({ id: result.agent_id }).first();
      expect(reviewer.status).toBe('completed');
    });
  });

  it('awaitAgent rejects waiting on the caller agent', async () => {
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    await expect(
      app
        .service('agents')
        .awaitAgent(
          { session_id: sessionId, agent_id: builder.id, caller_agent_id: builder.id },
          params(user)
        )
    ).rejects.toThrow('Cannot await your own agent');
  });

  it('awaitAgent waits for a reviewer turn', async () => {
    await setReviewerDefaults();
    const start = await app.service('agents').startReview({ session_id: sessionId }, params(user));
    const awaited = await app
      .service('agents')
      .awaitAgent({ session_id: sessionId, agent_id: start.agent_id }, params(user));
    expect(awaited.agent_type).toBe('reviewer');
    expect(awaited.status).toBe('completed');
  });

  it('continueReview posts a baguette latest-changes message', async () => {
    const [reviewerId] = await db('agents').insert({
      session_id: sessionId,
      name: 'Reviewer',
      agent_type: 'reviewer',
      is_primary: 0,
      status: 'completed',
      agent_config_id: claudeConfigId,
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 1,
    });
    const result = await app
      .service('agents')
      .continueReview(
        { session_id: sessionId, additional_instructions: 'check exports' },
        params(user)
      );
    expect(result.ok).toBe(true);
    expect(result.agent_id).toBe(reviewerId);
    const msg = await db('session_messages').where({ id: result.message_id }).first();
    expect(msg.subtype).toBe('baguette');
    const parsed = JSON.parse(msg.message_json);
    expect(parsed.title).toBe('Review latest changes');
    expect(parsed.content).toContain('check exports');
    await vi.waitFor(() => expect(query).toHaveBeenCalled());
  });
});

describe('StartReview / ContinueReview MCP tools', () => {
  it('StartReview surfaces service errors and success', async () => {
    const startTool = createStartReviewTool(mcpCtx());
    const failResult = payload(await startTool.handler({}));
    expect(failResult.ok).toBe(false);
    expect(failResult.error).toContain(MCP_REVIEWER_MODEL_SETTINGS_ERROR);

    await setReviewerDefaults();
    const okResult = payload(await startTool.handler({ initial_prompt: 'via mcp' }));
    expect(okResult.ok).toBe(true);
    expect(okResult.agent_id).toBeGreaterThan(0);
  });

  it('ContinueReview fails without a reviewer', async () => {
    const tool = createContinueReviewTool(mcpCtx());
    const result = payload(await tool.handler({ session_id: sessionId }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Start a review first');
  });
});
