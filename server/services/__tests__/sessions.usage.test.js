/**
 * Usage recording for Claude sessions, driven by the SDK `result` message.
 *
 * Baguette runs `query({ prompt: channel })` with an async-iterable channel, i.e.
 * streaming-input mode, where `total_cost_usd` and `modelUsage` are running
 * totals for the whole query rather than per-turn figures. Each turn's row is
 * therefore the difference from the previous result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { SessionsService } from '../feathers/sessions.service.js';

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const db = createTestDb({ beforeEach, afterEach });

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

/** An SDK result message as `messages.service` persists it. */
const resultMessage = (sessionId, { cost, models }) => ({
  session_id: sessionId,
  type: 'result',
  subtype: 'success',
  message_json: JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: cost,
    modelUsage: models,
  }),
});

async function seed() {
  const [userId] = await db('users').insert({ github_id: '1', username: 'tester' });
  const [sessionId] = await db('sessions').insert({
    user_id: userId,
    repo_full_name: 'acme/app',
    base_branch: 'main',
    initial_prompt: 'do a thing',
    agent_sdk: 'claude',
  });
  return { userId, sessionId };
}

function makeService() {
  const app = feathers();
  app.set('db', db);
  // The real sessions service writes the patch through, and onMessageCreated reads
  // `total_cost_usd` back off the row on the next turn, so this must persist too.
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

describe('claude usage recording', () => {
  it('records the first turn in full', async () => {
    const { sessionId } = await seed();
    const service = makeService();

    await service.onMessageCreated(
      resultMessage(sessionId, {
        cost: 0.12,
        models: { 'claude-opus-5': modelUsage(1000, 200, 50, 10) },
      })
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
    const { sessionId } = await seed();
    const service = makeService();

    await service.onMessageCreated(
      resultMessage(sessionId, { cost: 0.12, models: { 'claude-opus-5': modelUsage(1000, 200) } })
    );
    await service.onMessageCreated(
      resultMessage(sessionId, { cost: 0.3, models: { 'claude-opus-5': modelUsage(2500, 450) } })
    );

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[1].cost_usd)).toBeCloseTo(0.18, 6);
    expect(rows[1].input_tokens).toBe(1500);
    expect(rows[1].output_tokens).toBe(250);
  });

  it('keeps the session total equal to the last cumulative figure', async () => {
    const { sessionId } = await seed();
    const service = makeService();

    await service.onMessageCreated(
      resultMessage(sessionId, { cost: 0.12, models: { 'claude-opus-5': modelUsage(1000, 200) } })
    );
    await service.onMessageCreated(
      resultMessage(sessionId, { cost: 0.3, models: { 'claude-opus-5': modelUsage(2500, 450) } })
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
    const { sessionId } = await seed();
    const service = makeService();

    await service.onMessageCreated(
      resultMessage(sessionId, { cost: 0.5, models: { 'claude-opus-5': modelUsage(5000, 900) } })
    );
    // A resumed session starts its running totals over from zero.
    await service.onMessageCreated(
      resultMessage(sessionId, { cost: 0.02, models: { 'claude-opus-5': modelUsage(100, 20) } })
    );

    const rows = await usageRows(sessionId);
    expect(rows).toHaveLength(2);
    expect(parseFloat(rows[1].cost_usd)).toBeCloseTo(0.02, 6);
    expect(rows[1].input_tokens).toBe(100);
  });

  it('records tokens for a turn that was not billed', async () => {
    const { sessionId } = await seed();
    const service = makeService();

    await service.onMessageCreated(
      resultMessage(sessionId, { cost: 0, models: { 'claude-opus-5': modelUsage(800, 60) } })
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
    const { sessionId } = await seed();
    const service = makeService();

    const same = { 'claude-opus-5': modelUsage(1000, 200) };
    await service.onMessageCreated(resultMessage(sessionId, { cost: 0.12, models: same }));
    await service.onMessageCreated(resultMessage(sessionId, { cost: 0.12, models: same }));

    expect(await usageRows(sessionId)).toHaveLength(1);
  });

  it('still sets status when the result carries no usage at all', async () => {
    const { sessionId } = await seed();
    const service = makeService();

    await service.onMessageCreated({
      session_id: sessionId,
      type: 'result',
      subtype: 'success',
      message_json: JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
    });

    expect(await usageRows(sessionId)).toHaveLength(0);
    expect(service._patch).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ status: 'completed' }),
      expect.anything()
    );
  });
});
