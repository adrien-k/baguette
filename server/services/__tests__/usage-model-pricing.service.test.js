import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BadRequest } from 'feathers/errors';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerUsageModelPricingService } from '../feathers/usage-model-pricing.service.js';

const db = createTestDb({ beforeEach, afterEach });
const params = (user) => ({ provider: 'rest', user });

let app;
let user;

beforeEach(async () => {
  [user] = await db('users').insert({ github_id: '1', username: 'alice', approved: true });
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
});

describe('usage-model-pricing service', () => {
  it('lists used models with missing pricing', async () => {
    const { data } = await app.service('usage-model-pricing').find(params(user));
    expect(data.some((r) => r.model_id === 'unknown-model' && r.source === 'missing')).toBe(true);
  });

  it('lists built-in models as editable overrides', async () => {
    const sessionId = (await db('sessions').select('id').first()).id;
    await db('usage').insert({
      session_id: sessionId,
      user_id: user.id,
      repo_full_name: 'acme/app',
      model: 'claude-opus-5',
      agent_sdk: 'claude',
      input_tokens: 100,
      output_tokens: 0,
      total_tokens: 100,
      cost_usd: 0.001,
    });
    const { data } = await app.service('usage-model-pricing').find(params(user));
    const row = data.find((r) => r.model_id === 'claude-opus-5');
    expect(row?.source).toBe('builtin');
    expect(row?.editable).toBe(true);
    expect(row?.price_input).toBe(5);
  });

  it('rejects non-finite cache price fields', async () => {
    const svc = app.service('usage-model-pricing');
    await expect(
      svc.patch(
        'unknown-model',
        { price_input: 1, price_output: 1, price_cache_write: 'not-a-number' },
        params(user)
      )
    ).rejects.toThrow(BadRequest);
    await expect(
      svc.patch(
        'unknown-model',
        { price_input: 1, price_output: 1, price_cache_read: Number.NaN },
        params(user)
      )
    ).rejects.toThrow(BadRequest);
  });

  it('stores null for empty cache price fields', async () => {
    const svc = app.service('usage-model-pricing');
    await svc.patch(
      'unknown-model',
      {
        price_input: 1,
        price_output: 1,
        price_cache_write: '',
        price_cache_read: null,
      },
      params(user)
    );
    const row = await db('usage_model_pricing').where({ model_id: 'unknown-model' }).first();
    expect(row.price_cache_write).toBeNull();
    expect(row.price_cache_read).toBeNull();
  });

  it('saves custom rates and recomputes usage cost', async () => {
    const svc = app.service('usage-model-pricing');
    await svc.patch(
      'unknown-model',
      { price_input: 2, price_output: 4, price_cache_write: null, price_cache_read: null },
      params(user)
    );
    const result = await svc.recompute({ model_id: 'unknown-model' }, params(user));
    expect(result.updated_rows).toBe(1);
    expect(result.claude_usage_excluded).toBe(true);
    const row = await db('usage').where({ model: 'unknown-model' }).first();
    expect(parseFloat(row.cost_usd)).toBeCloseTo(2, 6);
  });
});
