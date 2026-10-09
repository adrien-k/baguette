import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { clearUsageModelPricingCache, resolveModelPricingRates } from '../usage-model-pricing.js';

const db = createTestDb({ beforeEach, afterEach });

describe('usage_model_pricing override cache', () => {
  beforeEach(() => {
    clearUsageModelPricingCache();
  });

  it('serves cached overrides until clearUsageModelPricingCache', async () => {
    await db('usage_model_pricing').insert({
      model_id: 'custom-model',
      price_input: 3,
      price_output: 4,
      price_cache_write: null,
      price_cache_read: null,
    });

    const first = await resolveModelPricingRates(db, 'custom-model', {});
    expect(first?.input).toBe(3);

    await db('usage_model_pricing').where({ model_id: 'custom-model' }).update({ price_input: 99 });

    const stillCached = await resolveModelPricingRates(db, 'custom-model', {});
    expect(stillCached?.input).toBe(3);

    clearUsageModelPricingCache();
    const refreshed = await resolveModelPricingRates(db, 'custom-model', {});
    expect(refreshed?.input).toBe(99);
  });
});
