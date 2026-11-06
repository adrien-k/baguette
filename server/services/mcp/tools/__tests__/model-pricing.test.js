import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../../../test-utils/db.js';
import { registerUsageModelPricingService } from '../../../feathers/usage-model-pricing.service.js';
import {
  createListMissingModelPricesTool,
  createRecomputeUsageCostsTool,
  createUpdateModelPricingTool,
} from '../model-pricing.js';

const db = createTestDb({ beforeEach, afterEach });

function parseResult(res) {
  return JSON.parse(res.content[0].text);
}

let app;
let user;
let ctx;

beforeEach(async () => {
  [user] = await db('users').insert({ github_id: '1', username: 'alice', status: 'approved' });
  user = await db('users').where({ id: user }).first();

  const sessionId = await insertTestSession(db, {
    user_id: user.id,
    repo_full_name: 'acme/app',
    base_branch: 'main',
    initial_prompt: 'go',
  });
  const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();

  await db('usage').insert({
    session_id: sessionId,
    user_id: user.id,
    agent_id: builder.id,
    repo_full_name: 'acme/app',
    model: 'unknown-model',
    agent_sdk: 'cursor',
    input_tokens: 1_000_000,
    output_tokens: 0,
    total_tokens: 1_000_000,
    cost_usd: 0,
  });

  app = feathers();
  app.set('db', db);
  registerUsageModelPricingService(app);
  await app.setup();
  ctx = { app, userId: user.id };
});

describe('model pricing MCP tools', () => {
  it('lists models with missing prices', async () => {
    const tool = createListMissingModelPricesTool(ctx);
    const result = parseResult(await tool.handler());
    expect(result.ok).toBe(true);
    expect(result.models.some((m) => m.model_id === 'unknown-model')).toBe(true);
  });

  it('updates rates and recomputes usage cost', async () => {
    const update = createUpdateModelPricingTool(ctx);
    const updated = parseResult(
      await update.handler({
        prices: [
          {
            model_id: 'unknown-model',
            price_input: 2,
            price_output: 4,
            price_cache_write: null,
            price_cache_read: null,
          },
        ],
      })
    );
    expect(updated.ok).toBe(true);
    expect(updated.updated[0].source).toBe('custom');

    const recompute = createRecomputeUsageCostsTool(ctx);
    const result = parseResult(await recompute.handler({ model_id: 'unknown-model' }));
    expect(result.ok).toBe(true);
    expect(result.updated_rows).toBe(1);
    expect(result).not.toHaveProperty('claude_usage_excluded');

    const row = await db('usage').where({ model: 'unknown-model' }).first();
    expect(parseFloat(row.cost_usd)).toBeCloseTo(2, 6);
  });

  it('rejects non-finite prices', async () => {
    const update = createUpdateModelPricingTool(ctx);
    const result = parseResult(
      await update.handler({
        prices: [
          {
            model_id: 'unknown-model',
            price_input: Number.NaN,
            price_output: 1,
          },
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/price_input|finite/i);
  });
});
