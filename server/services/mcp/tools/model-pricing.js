import { z } from 'zod';
import { ok, fail } from '../lib/result.js';

function userParams(userId) {
  return { provider: 'rest', user: { id: userId } };
}

function pricingService(ctx) {
  return ctx.app.service('usage-model-pricing');
}

export function createListMissingModelPricesTool(ctx) {
  const { userId } = ctx;
  return {
    name: 'ListMissingModelPrices',
    description:
      'List usage models that have no cost rates (not in the built-in table and no instance override). Returns model_id and usage_rows. Use before UpdateModelPricing.',
    schema: {},
    handler: async () => {
      try {
        const result = await pricingService(ctx).find(userParams(userId));
        const models = (result?.data ?? [])
          .filter((row) => row.source === 'missing')
          .map((row) => ({
            model_id: row.model_id,
            usage_rows: Number(row.usage_rows ?? 0),
          }));
        return ok({ models, count: models.length });
      } catch (err) {
        return fail(err.message || 'Failed to list missing model prices');
      }
    },
  };
}

const priceRowSchema = z.object({
  model_id: z.string().min(1).describe('Exact usage.model id from ListMissingModelPrices'),
  price_input: z.number().finite().describe('USD per 1M input tokens'),
  price_output: z.number().finite().describe('USD per 1M output tokens'),
  price_cache_write: z
    .number()
    .finite()
    .nullable()
    .optional()
    .describe('USD per 1M cache-write tokens, or null if not listed'),
  price_cache_read: z
    .number()
    .finite()
    .nullable()
    .optional()
    .describe('USD per 1M cache-read tokens, or null if not listed'),
});

export function createUpdateModelPricingTool(ctx) {
  const { userId } = ctx;
  return {
    name: 'UpdateModelPricing',
    description:
      'Upsert instance model prices as USD per 1M tokens. Extract rates from a pasted listing (Cursor docs, OpenRouter, or another reasonable reference) and match usage.model ids from ListMissingModelPrices. Does not edit the built-in catalog file. Call RecomputeUsageCosts afterwards.',
    schema: {
      prices: z
        .array(priceRowSchema)
        .min(1)
        .describe('One entry per model_id to insert or replace'),
    },
    handler: async ({ prices }) => {
      const svc = pricingService(ctx);
      const params = userParams(userId);
      const updated = [];
      try {
        for (const row of prices) {
          const saved = await svc.patch(
            row.model_id,
            {
              price_input: row.price_input,
              price_output: row.price_output,
              price_cache_write: row.price_cache_write ?? null,
              price_cache_read: row.price_cache_read ?? null,
            },
            params
          );
          updated.push({
            model_id: saved.model_id,
            source: saved.source,
            price_input: saved.price_input,
            price_output: saved.price_output,
            price_cache_write: saved.price_cache_write,
            price_cache_read: saved.price_cache_read,
          });
        }
        return ok({ updated, count: updated.length });
      } catch (err) {
        return fail(err.message || 'Failed to update model pricing');
      }
    },
  };
}

export function createRecomputeUsageCostsTool(ctx) {
  const { userId } = ctx;
  return {
    name: 'RecomputeUsageCosts',
    description:
      'Recompute stored usage.cost_usd from current model prices (built-in plus instance overrides) and refresh session totals. Optional model_id limits the rewrite.',
    schema: {
      model_id: z
        .string()
        .optional()
        .describe('If set, only recompute usage rows for this model id'),
    },
    handler: async ({ model_id } = {}) => {
      try {
        const result = await pricingService(ctx).recompute(
          model_id ? { model_id } : {},
          userParams(userId)
        );
        return ok(result);
      } catch (err) {
        return fail(err.message || 'Failed to recompute usage costs');
      }
    },
  };
}
