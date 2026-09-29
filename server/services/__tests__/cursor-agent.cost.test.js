/**
 * Cost and token recording for Cursor sessions.
 *
 * USD comes only from shared/cursor-model-pricing.js × per-turn tokens. We do not
 * call agent.getUsage() for cost — Baguette runs local Cursor agents, which return
 * feature_unavailable on that endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { CursorAgentService } from '../feathers/cursor-agent.service.js';
import { emptyTurnUsage } from '../turn-usage.js';

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const db = createTestDb({ beforeEach, afterEach });

const stubAgent = () => ({ agentId: 'agent-0000', getUsage: vi.fn() });

async function seedSession(overrides = {}) {
  const [userId] = await db('users').insert({ github_id: '1', username: 'tester' });
  const [sessionId] = await db('sessions').insert({
    user_id: userId,
    repo_full_name: 'acme/app',
    base_branch: 'main',
    initial_prompt: 'do a thing',
    agent_sdk: 'cursor',
    ...overrides,
  });
  return await db('sessions').where({ id: sessionId }).first();
}

function makeService() {
  const service = new CursorAgentService();
  const patch = vi.fn().mockResolvedValue({});
  service.setup({
    get: (key) => (key === 'db' ? db : undefined),
    service: () => ({ patch }),
  });
  service._patch = patch;
  return service;
}

describe('cursor cost recording', () => {
  it('estimates per-turn cost from the pricing table', async () => {
    const session = await seedSession();
    const service = makeService();
    const agent = stubAgent();
    const turnUsage = {
      ...emptyTurnUsage(),
      input_tokens: 8007,
      output_tokens: 12,
      cache_read_tokens: 3,
      cache_write_tokens: 1,
      total_tokens: 8019,
      model: 'gpt-5.4-nano',
    };

    await service._recordTurnUsage(session, agent, turnUsage);

    expect(agent.getUsage).not.toHaveBeenCalled();
    const rows = await db('usage').where({ session_id: session.id });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].raw_token_usage).input_tokens).toBe(8007);
    expect(rows[0].input_tokens).toBe(8004);
    expect(rows[0].total_tokens).toBe(8016);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.00161611, 6);
    expect(rows[0].agent_sdk).toBe('cursor');
    expect(service._patch).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ total_cost_usd: expect.any(Number) }),
      expect.anything()
    );
  });

  it('records zero cost when the model is not in the pricing table', async () => {
    const session = await seedSession({ model: 'composer-2' });
    const service = makeService();
    const turnUsage = {
      ...emptyTurnUsage(),
      input_tokens: 1000,
      total_tokens: 1000,
      model: 'composer-2',
    };

    await service._recordTurnUsage(session, stubAgent(), turnUsage);

    const rows = await db('usage').where({ session_id: session.id });
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBe(0);
    expect(service._patch).not.toHaveBeenCalled();
  });

  it('records nothing when there are no tokens and no priced cost', async () => {
    const session = await seedSession();
    const service = makeService();

    await service._recordTurnUsage(session, stubAgent(), emptyTurnUsage());

    expect(await db('usage').where({ session_id: session.id })).toHaveLength(0);
    expect(service._patch).not.toHaveBeenCalled();
  });

  it('accumulates session total across priced turns', async () => {
    const session = await seedSession();
    const service = makeService();
    const turnUsage = {
      ...emptyTurnUsage(),
      input_tokens: 1_000_000,
      total_tokens: 1_000_000,
      model: 'gpt-5.4-nano',
    };

    await service._recordTurnUsage(session, stubAgent(), turnUsage);
    await db('sessions').where({ id: session.id }).update({ total_cost_usd: 0.2 });
    await service._recordTurnUsage(session, stubAgent(), turnUsage);

    const rows = await db('usage').where({ session_id: session.id }).orderBy('id');
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.2, 6);
    expect(parseFloat(rows[1].cost_usd)).toBeCloseTo(0.2, 6);
    expect(service._patch).toHaveBeenLastCalledWith(
      session.id,
      { total_cost_usd: 0.4 },
      expect.anything()
    );
  });

  it('uses turn model params for pricing, not the session snapshot', async () => {
    const session = await seedSession({
      model: 'composer-2.5',
      model_params: JSON.stringify([{ id: 'fast', value: 'false' }]),
    });
    const service = makeService();
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

    await service._recordTurnUsage(session, stubAgent(), turnUsage, { turnModel });

    const rows = await db('usage').where({ session_id: session.id });
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(3, 6);
  });

  it('falls back to the session model when the run did not name one', async () => {
    const session = await seedSession({ model: 'composer-2' });
    const service = makeService();
    const turnUsage = { ...emptyTurnUsage(), total_tokens: 40 };

    await service._recordTurnUsage(session, stubAgent(), turnUsage);

    const rows = await db('usage').where({ session_id: session.id });
    expect(rows[0].model).toBe('composer-2');
  });
});
