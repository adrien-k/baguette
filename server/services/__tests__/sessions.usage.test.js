/**
 * Usage recording for Claude sessions, driven by the SDK `result` message.
 *
 * Baguette runs `query({ prompt: channel })` with an async-iterable channel, i.e.
 * streaming-input mode, where `total_cost_usd` and `modelUsage` are running
 * totals for the whole query rather than per-turn figures. Each turn's row is
 * therefore the difference from the previous result.
 */
import { describe, it, expect, vi } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { ensureReviewerAgentRow } from '../agents-db.js';
import { SessionsService } from '../feathers/sessions.service.js';
import { emptyTurnUsage } from '../turn-usage.js';

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const db = createTestDb();

async function sessionForUsage(sessionId) {
  const session = await db('sessions').where({ id: sessionId }).first();
  const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
  const reviewer = await db('agents')
    .where({ session_id: sessionId, agent_type: 'reviewer' })
    .first();
  return {
    ...session,
    agent_sdk: builder?.agent_sdk,
    model: builder?.model,
    model_params: builder?.model_params,
    agent_config_id: builder?.agent_config_id,
    review_agent_sdk: reviewer?.agent_sdk,
    review_model: reviewer?.model,
  };
}

const modelUsage = (input, output, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheWrite,
  webSearchRequests: 0,
  costUSD: 0,
  contextWindow: 200000,
  maxOutputTokens: 64000,
});

/** An SDK result message as persisted on a turn_result row. */
const resultPayload = ({ cost, models }) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  total_cost_usd: cost,
  modelUsage: models,
});

async function insertTestAgentConfig(userId, sdk = 'claude') {
  const [id] = await db('agent_configs').insert({
    user_id: userId,
    label: 'test',
    sdk,
  });
  return id;
}

async function seed() {
  const [userId] = await db('users').insert({ github_id: '1', username: 'tester' });
  const agentConfigId = await insertTestAgentConfig(userId);
  const sessionId = await insertTestSession(db, {
    user_id: userId,
    repo_full_name: 'acme/app',
    base_branch: 'main',
    initial_prompt: 'do a thing',
    agent_sdk: 'claude',
    agent_config_id: agentConfigId,
  });
  return { userId, sessionId, agentConfigId };
}

function makeService() {
  const app = feathers();
  app.set('db', db);
  const patch = vi.fn(async (id, data) => {
    await db('sessions').where({ id }).update(data);
    return await db('sessions').where({ id }).first();
  });
  const service = new SessionsService({ Model: db, name: 'sessions' });
  service.setup({ get: (k) => (k === 'db' ? db : undefined), service: () => ({ patch }) });
  service._patch = patch;
  return service;
}

const usageRows = (sessionId) => db('usage').where({ session_id: sessionId }).orderBy('id');

const claudeTurnModel = { model: 'sonnet', modelParams: null };

function claudeRecordOpts(agentConfigId, extra = {}) {
  return { agentConfigId, turnModel: claudeTurnModel, ...extra };
}

describe('claude usage recording', () => {
  it('records the first turn in full', async () => {
    const { sessionId, agentConfigId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.12, models: { 'claude-opus-5': modelUsage(1000, 200, 50, 10) } }),
      claudeRecordOpts(agentConfigId, { patchSessionCost: true })
    );

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.12, 6);
    expect(rows[0].input_tokens).toBe(1000);
    expect(rows[0].output_tokens).toBe(200);
    expect(rows[0].cache_read_tokens).toBe(50);
    expect(rows[0].cache_write_tokens).toBe(10);
    expect(rows[0].total_tokens).toBe(1260);
    expect(rows[0].model).toBe('claude-opus-5');
    expect(rows[0].agent_sdk).toBe('claude');
  });

  it('records only the increment on the second turn', async () => {
    const { sessionId, agentConfigId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.12, models: { 'claude-opus-5': modelUsage(1000, 200) } }),
      claudeRecordOpts(agentConfigId)
    );
    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.3, models: { 'claude-opus-5': modelUsage(2500, 450) } }),
      claudeRecordOpts(agentConfigId)
    );

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[1].cost_usd)).toBeCloseTo(0.18, 6);
    expect(rows[1].input_tokens).toBe(1500);
    expect(rows[1].output_tokens).toBe(250);
  });

  it('keeps the session total equal to the last cumulative figure', async () => {
    const { sessionId, agentConfigId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.12, models: { 'claude-opus-5': modelUsage(1000, 200) } }),
      claudeRecordOpts(agentConfigId, { patchSessionCost: true })
    );
    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.3, models: { 'claude-opus-5': modelUsage(2500, 450) } }),
      claudeRecordOpts(agentConfigId, { patchSessionCost: true })
    );

    const totals = await db('usage')
      .where({ session_id: sessionId })
      .sum('cost_usd as total')
      .first();
    expect(parseFloat(totals.total)).toBeCloseTo(0.3, 6);

    const patched = service._patch.mock.calls.at(-1)[1];
    expect(patched.total_cost_usd).toBeCloseTo(0.3, 6);
  });

  it('treats a reset counter after a resume as fresh work', async () => {
    const { sessionId, agentConfigId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.5, models: { 'claude-opus-5': modelUsage(5000, 900) } }),
      claudeRecordOpts(agentConfigId)
    );
    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.02, models: { 'claude-opus-5': modelUsage(100, 20) } }),
      claudeRecordOpts(agentConfigId)
    );

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[1].cost_usd)).toBeCloseTo(0.02, 6);
    expect(rows[1].input_tokens).toBe(100);
  });

  it('records tokens for a turn that was not billed', async () => {
    const { sessionId, agentConfigId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0, models: { 'claude-opus-5': modelUsage(800, 60) } }),
      claudeRecordOpts(agentConfigId)
    );

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBe(0);
    expect(rows[0].total_tokens).toBe(860);
    expect(service._patch).not.toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ total_cost_usd: expect.anything() }),
      expect.anything()
    );
  });

  it('writes no row for a turn that moved neither cost nor tokens', async () => {
    const { sessionId, agentConfigId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    const same = { 'claude-opus-5': modelUsage(1000, 200) };
    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.12, models: same }),
      claudeRecordOpts(agentConfigId)
    );
    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.12, models: same }),
      claudeRecordOpts(agentConfigId)
    );

    expect(await usageRows(sessionId)).toHaveLength(1);
  });

  it('onMessageCreated does not insert usage from result rows', async () => {
    const { sessionId } = await seed();
    const service = makeService();

    await service.onMessageCreated({
      session_id: sessionId,
      type: 'turn_result',
      message_json: JSON.stringify(resultPayload({ cost: 0.5, models: {} })),
    });

    expect(await usageRows(sessionId)).toHaveLength(0);
    expect(service._patch).not.toHaveBeenCalled();
  });

  it('stores the passed agentConfigId on the usage row', async () => {
    const { userId, sessionId } = await seed();
    const [configA] = await db('agent_configs').insert({
      user_id: userId,
      label: 'A',
      sdk: 'claude',
    });
    const [configB] = await db('agent_configs').insert({
      user_id: userId,
      label: 'B',
      sdk: 'claude',
    });
    await db('agents')
      .where({ session_id: sessionId, is_primary: 1 })
      .update({ agent_config_id: configB });
    const service = makeService();
    const session = await sessionForUsage(sessionId);

    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.12, models: { 'claude-opus-5': modelUsage(1000, 200) } }),
      claudeRecordOpts(configA)
    );

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_config_id).toBe(configA);
  });

  it('records review usage without mixing chat running totals', async () => {
    const { sessionId, agentConfigId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    await service.recordClaudeUsage(
      session,
      resultPayload({ cost: 0.12, models: { 'claude-opus-5': modelUsage(1000, 200) } }),
      claudeRecordOpts(agentConfigId)
    );
    const reviewer = await ensureReviewerAgentRow(db, sessionId, {
      agent_sdk: 'claude',
      model: 'sonnet',
      status: 'completed',
      agent_config_id: agentConfigId,
    });
    await service.recordClaudeUsage(
      session,
      { total_cost_usd: 0.01, modelUsage: { 'claude-opus-5': modelUsage(10, 5) } },
      claudeRecordOpts(agentConfigId, {
        totalsKey: `review:${reviewer.id}`,
        patchSessionCost: true,
        agentId: reviewer.id,
      })
    );

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(2);
    expect(rows[0].agent_type).toBe('builder');
    expect(rows[1].agent_type).toBe('reviewer');
    expect(parseFloat(rows[1].cost_usd)).toBeCloseTo(0.01, 6);
    expect(rows[1].input_tokens).toBe(10);
    expect(rows[1].output_tokens).toBe(5);
  });
});

describe('cursor usage recording', () => {
  async function seedCursor(overrides = {}) {
    const [userId] = await db('users').insert({ github_id: '1', username: 'tester' });
    const agentConfigId = await insertTestAgentConfig(userId, 'cursor');
    const sessionId = await insertTestSession(db, {
      user_id: userId,
      repo_full_name: 'acme/app',
      base_branch: 'main',
      initial_prompt: 'do a thing',
      agent_sdk: 'cursor',
      agent_config_id: agentConfigId,
      ...overrides,
    });
    return { userId, sessionId, agentConfigId };
  }

  it('estimates per-turn cost from the pricing table', async () => {
    const { sessionId, agentConfigId } = await seedCursor();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();
    const turnUsage = {
      ...emptyTurnUsage(),
      input_tokens: 8007,
      output_tokens: 12,
      cache_read_tokens: 3,
      cache_write_tokens: 1,
      total_tokens: 8019,
      model: 'gpt-5.4-nano',
    };

    await service.recordCursorUsage(session, turnUsage, {
      agentConfigId,
      turnModel: { model: 'gpt-5.4-nano', modelParams: null },
      patchSessionCost: true,
    });

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].raw_token_usage).input_tokens).toBe(8007);
    expect(rows[0].input_tokens).toBe(8004);
    expect(rows[0].total_tokens).toBe(8016);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.00161526, 5);
    expect(rows[0].agent_sdk).toBe('cursor');
    expect(service._patch).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ total_cost_usd: expect.any(Number) }),
      expect.anything()
    );
  });

  it('records zero cost when the model is not in the pricing table', async () => {
    const { sessionId, agentConfigId } = await seedCursor({ model: 'composer-2' });
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();
    const turnUsage = {
      ...emptyTurnUsage(),
      input_tokens: 1000,
      total_tokens: 1000,
      model: 'composer-2',
    };

    await service.recordCursorUsage(session, turnUsage, {
      agentConfigId,
      turnModel: { model: 'composer-2', modelParams: null },
      patchSessionCost: true,
    });

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBe(0);
    expect(service._patch).not.toHaveBeenCalled();
  });

  it('records nothing when there are no tokens and no priced cost', async () => {
    const { sessionId, agentConfigId } = await seedCursor();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    await service.recordCursorUsage(session, emptyTurnUsage(), {
      agentConfigId,
      turnModel: { model: 'gpt-5.4-nano', modelParams: null },
      patchSessionCost: true,
    });

    expect(await usageRows(sessionId)).toHaveLength(0);
    expect(service._patch).not.toHaveBeenCalled();
  });

  it('accumulates session total across priced turns', async () => {
    const { sessionId, agentConfigId } = await seedCursor();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();
    const turnUsage = {
      ...emptyTurnUsage(),
      input_tokens: 1_000_000,
      total_tokens: 1_000_000,
      model: 'gpt-5.4-nano',
    };

    const cursorOpts = {
      agentConfigId,
      turnModel: { model: 'gpt-5.4-nano', modelParams: null },
      patchSessionCost: true,
    };
    await service.recordCursorUsage(session, turnUsage, cursorOpts);
    await db('sessions').where({ id: sessionId }).update({ total_cost_usd: 0.2 });
    await service.recordCursorUsage(session, turnUsage, cursorOpts);

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.2, 6);
    expect(parseFloat(rows[1].cost_usd)).toBeCloseTo(0.2, 6);
    expect(service._patch).toHaveBeenLastCalledWith(
      sessionId,
      { total_cost_usd: 0.4 },
      expect.anything()
    );
  });

  it('uses turn model params for pricing, not the session snapshot', async () => {
    const { sessionId, agentConfigId } = await seedCursor({
      model: 'composer-2.5',
      model_params: JSON.stringify([{ id: 'fast', value: 'false' }]),
    });
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();
    const turnUsage = {
      ...emptyTurnUsage(),
      input_tokens: 1_000_000,
      total_tokens: 1_000_000,
      model: 'composer-2.5',
    };
    const turnModel = {
      model: 'composer-2.5',
      modelParams: JSON.stringify([{ id: 'fast', value: 'true' }]),
    };

    await service.recordCursorUsage(session, turnUsage, {
      turnModel,
      agentConfigId,
      patchSessionCost: true,
    });

    const rows = await usageRows(sessionId);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(3, 6);
    expect(rows[0].model_params).toBe(turnModel.modelParams);
  });

  it('stores the turn model when token usage did not name one', async () => {
    const { sessionId, agentConfigId } = await seedCursor({ model: 'composer-2' });
    const service = makeService();
    const session = await sessionForUsage(sessionId);
    const turnUsage = { ...emptyTurnUsage(), total_tokens: 40 };

    await service.recordCursorUsage(session, turnUsage, {
      agentConfigId,
      turnModel: { model: 'composer-2', modelParams: null },
      patchSessionCost: true,
    });

    const rows = await usageRows(sessionId);
    expect(rows[0].model).toBe('composer-2');
  });
});

describe('sessionUsage', () => {
  it('aggregates usage by model and builder vs reviewer agent_type', async () => {
    const { sessionId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();

    await db('usage').insert([
      {
        session_id: sessionId,
        user_id: session.user_id,
        repo_full_name: 'acme/app',
        cost_usd: 0.1,
        agent_sdk: 'claude',
        model: 'claude-opus-5',
        agent_type: 'builder',
        total_tokens: 100,
        input_tokens: 80,
        output_tokens: 20,
      },
      {
        session_id: sessionId,
        user_id: session.user_id,
        repo_full_name: 'acme/app',
        cost_usd: 0.02,
        agent_sdk: 'cursor',
        model: 'composer-1',
        agent_type: 'reviewer',
        total_tokens: 50,
        input_tokens: 40,
        output_tokens: 10,
      },
    ]);

    const usage = await service.sessionUsage(null, {
      user: { id: session.user_id },
      resolvedSession: session,
    });
    expect(usage.breakdown.filter((r) => r.agent_type === 'builder')).toHaveLength(1);
    expect(usage.breakdown.filter((r) => r.agent_type === 'reviewer')).toHaveLength(1);
  });

  it('returns per-agent cost totals in by_agent', async () => {
    const { sessionId, agentConfigId } = await seed();
    const service = makeService();
    const session = await db('sessions').where({ id: sessionId }).first();
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const reviewer = await ensureReviewerAgentRow(db, sessionId, {
      agent_config_id: agentConfigId,
      agent_sdk: 'claude',
    });

    await db('usage').insert([
      {
        session_id: sessionId,
        user_id: session.user_id,
        repo_full_name: 'acme/app',
        cost_usd: 0.1,
        agent_id: builder.id,
        agent_type: 'builder',
        total_tokens: 10,
      },
      {
        session_id: sessionId,
        user_id: session.user_id,
        repo_full_name: 'acme/app',
        cost_usd: 0.02,
        agent_id: reviewer.id,
        agent_type: 'reviewer',
        total_tokens: 5,
      },
    ]);

    const usage = await service.sessionUsage(null, {
      user: { id: session.user_id },
      resolvedSession: session,
    });
    const byId = new Map(usage.by_agent.map((r) => [r.agent_id, r.cost_usd]));
    expect(byId.get(builder.id)).toBeCloseTo(0.1, 6);
    expect(byId.get(reviewer.id)).toBeCloseTo(0.02, 6);
  });
});
