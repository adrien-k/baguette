import { BadRequest } from '@feathersjs/errors';
import { requireUser } from './hooks.js';
import {
  clearUsageModelPricingCache,
  pricingSourceForModel,
  ratesFromDbRow,
} from '../../lib/usage-model-pricing.js';
import { recomputeUsageCosts } from '../../lib/usage-recompute.js';

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number|null}
 */
function optionalPriceField(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new BadRequest(`${fieldName} must be a finite number or null`);
  }
  return n;
}

function ratesToApi(rates) {
  if (!rates) {
    return {
      price_input: null,
      price_cache_write: null,
      price_cache_read: null,
      price_output: null,
    };
  }
  return {
    price_input: rates.input,
    price_cache_write: rates.cacheWrite,
    price_cache_read: rates.cacheRead,
    price_output: rates.output,
  };
}

class UsageModelPricingService {
  setup(app) {
    this.app = app;
  }

  async find() {
    const db = this.app.get('db');
    const used = await db('usage')
      .whereNotNull('model')
      .where('model', '<>', '')
      .groupBy('model')
      .select('model as model_id')
      .count('* as usage_rows');

    const custom = await db('usage_model_pricing').select('model_id');
    const modelIds = new Set([...used.map((r) => r.model_id), ...custom.map((r) => r.model_id)]);

    const usageCount = new Map(used.map((r) => [r.model_id, Number(r.usage_rows ?? 0)]));
    const data = [];
    for (const modelId of [...modelIds].sort()) {
      const { source, rates, editable } = await pricingSourceForModel(db, modelId);
      data.push({
        model_id: modelId,
        source,
        editable,
        usage_rows: usageCount.get(modelId) ?? 0,
        ...ratesToApi(rates),
      });
    }

    return { data, total: data.length, limit: data.length, skip: 0 };
  }

  async patch(modelId, data) {
    const id = String(modelId || '').trim();
    if (!id) throw new BadRequest('model_id is required');

    const price_input = Number(data.price_input);
    const price_output = Number(data.price_output);
    if (!Number.isFinite(price_input) || !Number.isFinite(price_output)) {
      throw new BadRequest('price_input and price_output are required numbers');
    }

    const row = {
      model_id: id,
      price_input,
      price_output,
      price_cache_write: optionalPriceField(data.price_cache_write, 'price_cache_write'),
      price_cache_read: optionalPriceField(data.price_cache_read, 'price_cache_read'),
      updated_at: new Date().toISOString(),
    };

    const db = this.app.get('db');
    const existing = await db('usage_model_pricing').where({ model_id: id }).first();
    if (existing) {
      await db('usage_model_pricing').where({ model_id: id }).update(row);
    } else {
      await db('usage_model_pricing').insert(row);
    }

    const saved = await db('usage_model_pricing').where({ model_id: id }).first();
    clearUsageModelPricingCache();
    const rates = ratesFromDbRow(saved);
    return {
      model_id: id,
      source: 'custom',
      editable: true,
      usage_rows: Number(
        (await db('usage').where({ model: id }).count('* as count').first())?.count ?? 0
      ),
      ...ratesToApi(rates),
    };
  }

  async recompute(data) {
    const modelId = data?.model_id ? String(data.model_id).trim() : null;
    const db = this.app.get('db');
    return recomputeUsageCosts(db, { modelId });
  }
}

export function registerUsageModelPricingService(app, path = 'usage-model-pricing') {
  app.use(path, new UsageModelPricingService(), {
    methods: ['find', 'patch', 'recompute'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser],
    },
  });
}
