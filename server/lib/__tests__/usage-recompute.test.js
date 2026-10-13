import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { clearUsageModelPricingCache } from '../usage-model-pricing.js';
import { recomputeUsageCosts } from '../usage-recompute.js';

const db = createTestDb({ beforeEach, afterEach });

describe('recomputeUsageCosts', () => {
  beforeEach(() => {
    clearUsageModelPricingCache();
  });

  it('batch-updates usage rows and session totals', async () => {
    const [userId] = await db('users').insert({
      github_id: 'recompute-user',
      username: 'bob',
      approved: true,
    });
    const sessionId = await insertTestSession(db, {
      user_id: userId,
      repo_full_name: 'acme/app',
      base_branch: 'main',
      initial_prompt: 'go',
      total_cost_usd: 0,
    });
    const builderAgent = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();

    await db('usage_model_pricing').insert({
      model_id: 'batch-model',
      price_input: 1,
      price_output: 0,
      price_cache_write: null,
      price_cache_read: null,
    });

    await db('usage').insert([
      {
        session_id: sessionId,
        user_id: userId,
        agent_id: builderAgent.id,
        repo_full_name: 'acme/app',
        model: 'batch-model',
        agent_sdk: 'cursor',
        input_tokens: 1_000_000,
        output_tokens: 0,
        total_tokens: 1_000_000,
        cost_usd: 0,
      },
      {
        session_id: sessionId,
        user_id: userId,
        agent_id: builderAgent.id,
        repo_full_name: 'acme/app',
        model: 'batch-model',
        agent_sdk: 'cursor',
        input_tokens: 500_000,
        output_tokens: 0,
        total_tokens: 500_000,
        cost_usd: 0,
      },
    ]);

    const result = await recomputeUsageCosts(db, { modelId: 'batch-model' });
    expect(result.updated_rows).toBe(2);
    expect(result.affected_sessions).toBe(1);
    expect(result.claude_usage_excluded).toBe(true);
    expect(result.skipped_claude_rows).toBe(0);

    const usageRows = await db('usage').where({ session_id: sessionId }).orderBy('id');
    expect(parseFloat(usageRows[0].cost_usd)).toBeCloseTo(1, 6);
    expect(parseFloat(usageRows[1].cost_usd)).toBeCloseTo(0.5, 6);

    const session = await db('sessions').where({ id: sessionId }).first();
    expect(parseFloat(session.total_cost_usd)).toBeCloseTo(1.5, 6);
  });

  it('reports skipped Claude rows in the response', async () => {
    const [userId] = await db('users').insert({
      github_id: 'claude-skip',
      username: 'carol',
      approved: true,
    });
    const sessionId = await insertTestSession(db, {
      user_id: userId,
      repo_full_name: 'acme/app',
      base_branch: 'main',
      initial_prompt: 'go',
    });
    await db('usage').insert({
      session_id: sessionId,
      user_id: userId,
      repo_full_name: 'acme/app',
      model: 'claude-only',
      agent_sdk: 'claude',
      input_tokens: 100,
      output_tokens: 0,
      total_tokens: 100,
      cost_usd: 0.5,
    });

    const result = await recomputeUsageCosts(db, { modelId: 'claude-only' });
    expect(result.updated_rows).toBe(0);
    expect(result.skipped_claude_rows).toBe(1);
    expect(result.claude_usage_excluded).toBe(true);
  });
});
