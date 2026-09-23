/**
 * Cost and token recording for Cursor sessions.
 *
 * Cursor's usage API is eventually consistent (cost lands after the run ends)
 * and answers 403 `feature_unavailable` for local agents, which is what Baguette
 * runs. Both were silently dropping every session's cost. Tokens come from the
 * run stream instead and are reported whatever the cost API says.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { CursorAgentService } from '../feathers/cursor-agent.service.js';
import { emptyTurnUsage } from '../turn-usage.js';

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const db = createTestDb({ beforeEach, afterEach });

/** A `CursorSdkError`-shaped rejection: the SDK exposes the backend code on `.code`. */
function sdkError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.status = 403;
  return err;
}

/** A turn that reported no tokens, so these cases exercise the cost path alone. */
const noTokens = () => emptyTurnUsage();

/** Baguette always runs local agents, whose ids are `agent-<uuid>`. */
const localAgent = (getUsage) => ({ agentId: 'agent-0000', getUsage });
const cloudAgent = (getUsage) => ({ agentId: 'bc-0000', getUsage });

async function seedSession() {
  const [userId] = await db('users').insert({ github_id: '1', username: 'tester' });
  const [sessionId] = await db('sessions').insert({
    user_id: userId,
    repo_full_name: 'acme/app',
    base_branch: 'main',
    initial_prompt: 'do a thing',
    agent_sdk: 'cursor',
  });
  return await db('sessions').where({ id: sessionId }).first();
}

function makeService(session) {
  const service = new CursorAgentService();
  const patch = vi.fn().mockResolvedValue({});
  service.setup({
    get: (key) => (key === 'db' ? db : undefined),
    service: () => ({ patch }),
  });
  service._session = session;
  service._patch = patch;
  return service;
}

describe('cursor cost recording', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Drive a fake-timer run to completion without waiting out the real backoff. */
  async function runWithTimers(promise) {
    await vi.runAllTimersAsync();
    return await promise;
  }

  it('records the cost once it lands after the billing lag', async () => {
    const session = await seedSession();
    const service = makeService(session);

    const getUsage = vi
      .fn()
      .mockResolvedValueOnce({ usage: {}, runs: [] })
      .mockResolvedValueOnce({ usage: {}, runs: [] })
      .mockResolvedValue({ cost: { chargedCents: 42, rawCostCents: 50 }, usage: {}, runs: [] });

    await runWithTimers(service._recordTurnUsage(session, localAgent(getUsage), noTokens()));

    expect(getUsage).toHaveBeenCalledTimes(3);
    const rows = await db('usage').where({ session_id: session.id });
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.42, 6);
    expect(rows[0].agent_sdk).toBe('cursor');
    expect(service._patch).toHaveBeenCalledWith(
      session.id,
      { total_cost_usd: 0.42 },
      expect.anything()
    );
  });

  it('falls back to rawCostCents when nothing was charged (plan-included / BYOK)', async () => {
    const session = await seedSession();
    const service = makeService(session);

    const getUsage = vi
      .fn()
      .mockResolvedValue({ cost: { chargedCents: 0, rawCostCents: 31 }, usage: {}, runs: [] });

    await runWithTimers(service._recordTurnUsage(session, localAgent(getUsage), noTokens()));

    const rows = await db('usage').where({ session_id: session.id });
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.31, 6);
  });

  it('only charges the delta over what the session already recorded', async () => {
    const session = await seedSession();
    const service = makeService(session);
    await db('usage').insert({
      session_id: session.id,
      user_id: session.user_id,
      repo_full_name: session.repo_full_name,
      cost_usd: 0.3,
      agent_sdk: 'cursor',
    });

    const getUsage = vi
      .fn()
      .mockResolvedValue({ cost: { chargedCents: 50, rawCostCents: 50 }, usage: {}, runs: [] });

    await runWithTimers(service._recordTurnUsage(session, localAgent(getUsage), noTokens()));

    const rows = await db('usage').where({ session_id: session.id }).orderBy('id');
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[1].cost_usd)).toBeCloseTo(0.2, 6);
  });

  it('stops calling getUsage after a feature_unavailable response', async () => {
    const session = await seedSession();
    const service = makeService(session);

    const getUsage = vi
      .fn()
      .mockRejectedValue(
        sdkError('feature_unavailable', '[feature_unavailable] This feature is not available')
      );
    const agent = localAgent(getUsage);

    await runWithTimers(service._recordTurnUsage(session, agent, noTokens()));
    expect(getUsage).toHaveBeenCalledTimes(1);

    // A later turn must not retry an endpoint that is closed to this runtime.
    await runWithTimers(service._recordTurnUsage(session, agent, noTokens()));
    expect(getUsage).toHaveBeenCalledTimes(1);

    expect(await db('usage').where({ session_id: session.id })).toHaveLength(0);
  });

  it('keeps reading usage for cloud agents after local agents came back gated', async () => {
    const session = await seedSession();
    const service = makeService(session);

    const localUsage = vi.fn().mockRejectedValue(sdkError('feature_unavailable', 'nope'));
    await runWithTimers(service._recordTurnUsage(session, localAgent(localUsage), noTokens()));

    const cloudUsage = vi
      .fn()
      .mockResolvedValue({ cost: { chargedCents: 25, rawCostCents: 25 }, usage: {}, runs: [] });
    await runWithTimers(service._recordTurnUsage(session, cloudAgent(cloudUsage), noTokens()));

    expect(cloudUsage).toHaveBeenCalled();
    const rows = await db('usage').where({ session_id: session.id });
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.25, 6);
  });

  it('propagates unexpected usage errors to the caller', async () => {
    const session = await seedSession();
    const service = makeService(session);

    const getUsage = vi.fn().mockRejectedValue(sdkError('internal', 'boom'));

    // The first attempt has no backoff, so this rejects before any timer runs.
    await expect(
      service._recordTurnUsage(session, localAgent(getUsage), noTokens())
    ).rejects.toThrow('boom');
    expect(service._usageUnavailable.has('local')).toBe(false);
  });

  it('records nothing when the backend never reports a cost', async () => {
    const session = await seedSession();
    const service = makeService(session);

    const getUsage = vi.fn().mockResolvedValue({ usage: {}, runs: [] });

    await runWithTimers(service._recordTurnUsage(session, localAgent(getUsage), noTokens()));

    expect(getUsage).toHaveBeenCalledTimes(4);
    expect(await db('usage').where({ session_id: session.id })).toHaveLength(0);
    expect(service._patch).not.toHaveBeenCalled();
  });

  it('records tokens and model even when cost is unavailable', async () => {
    const session = await seedSession();
    const service = makeService(session);

    const getUsage = vi.fn().mockRejectedValue(sdkError('feature_unavailable', 'nope'));
    const turnUsage = {
      ...emptyTurnUsage(),
      input_tokens: 8007,
      output_tokens: 12,
      cache_read_tokens: 3,
      cache_write_tokens: 1,
      total_tokens: 8019,
      model: 'gpt-5.4-nano',
    };

    await runWithTimers(service._recordTurnUsage(session, localAgent(getUsage), turnUsage));

    const rows = await db('usage').where({ session_id: session.id });
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBe(0);
    expect(rows[0].input_tokens).toBe(8007);
    expect(rows[0].output_tokens).toBe(12);
    expect(rows[0].total_tokens).toBe(8019);
    expect(rows[0].model).toBe('gpt-5.4-nano');
    // Nothing was billed, so the session's cost total must not move.
    expect(service._patch).not.toHaveBeenCalled();
  });

  it('records tokens and cost together when both are available', async () => {
    const session = await seedSession();
    const service = makeService(session);

    const getUsage = vi
      .fn()
      .mockResolvedValue({ cost: { chargedCents: 42, rawCostCents: 50 }, usage: {}, runs: [] });
    const turnUsage = { ...emptyTurnUsage(), total_tokens: 500, model: 'gpt-5.4-nano' };

    await runWithTimers(service._recordTurnUsage(session, cloudAgent(getUsage), turnUsage));

    const rows = await db('usage').where({ session_id: session.id });
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0].cost_usd)).toBeCloseTo(0.42, 6);
    expect(rows[0].total_tokens).toBe(500);
  });

  it('falls back to the session model when the run did not name one', async () => {
    const session = await seedSession();
    await db('sessions').where({ id: session.id }).update({ model: 'composer-2' });
    const service = makeService(session);

    const getUsage = vi.fn().mockRejectedValue(sdkError('feature_unavailable', 'nope'));
    const turnUsage = { ...emptyTurnUsage(), total_tokens: 40 };

    await runWithTimers(
      service._recordTurnUsage({ ...session, model: 'composer-2' }, localAgent(getUsage), turnUsage)
    );

    const rows = await db('usage').where({ session_id: session.id });
    expect(rows[0].model).toBe('composer-2');
  });
});
