import {
  estimateCostUsdFromRates,
  lookupAgentModelPricing,
  parseModelParamsJson,
} from '../../shared/agent-model-pricing.js';

/** @param {Record<string, unknown>|null|undefined} row */
export function ratesFromDbRow(row) {
  if (!row) return null;
  return {
    input: Number(row.price_input) || 0,
    cacheWrite: row.price_cache_write == null ? null : Number(row.price_cache_write),
    cacheRead: row.price_cache_read == null ? null : Number(row.price_cache_read),
    output: Number(row.price_output) || 0,
  };
}

/** @type {Map<string, ReturnType<typeof ratesFromDbRow>>|null} */
let usageModelPricingOverrides = null;

/** Drop cached DB overrides (call after `usage_model_pricing` writes). */
export function clearUsageModelPricingCache() {
  usageModelPricingOverrides = null;
}

/**
 * @param {import('knex').Knex} db
 * @returns {Promise<Map<string, ReturnType<typeof ratesFromDbRow>>>}
 */
async function loadUsageModelPricingOverrides(db) {
  if (usageModelPricingOverrides) return usageModelPricingOverrides;
  const rows = await db('usage_model_pricing').select('*');
  usageModelPricingOverrides = new Map(
    rows.map((row) => [String(row.model_id), ratesFromDbRow(row)])
  );
  return usageModelPricingOverrides;
}

/** Load DB pricing overrides once (e.g. before bulk recompute). */
export async function warmUsageModelPricingCache(db) {
  await loadUsageModelPricingOverrides(db);
}

/**
 * @param {string|null|undefined} modelId
 * @param {Record<string, string>|null|undefined} modelParams
 */
function resolveModelPricingRatesSync(modelId, modelParams) {
  if (!modelId) return null;
  if (!usageModelPricingOverrides) {
    throw new Error('usage_model_pricing cache not warmed; call warmUsageModelPricingCache first');
  }
  const custom = usageModelPricingOverrides.get(modelId);
  if (custom) return custom;
  return lookupAgentModelPricing(modelId, modelParams ?? {});
}

/**
 * @param {Record<string, number>} turnUsage
 * @param {string|null|undefined} modelId
 * @param {unknown} modelParamsJson
 */
export function estimateTurnCostUsdSync(turnUsage, modelId, modelParamsJson) {
  const rates = resolveModelPricingRatesSync(modelId, parseModelParamsJson(modelParamsJson));
  if (!rates || !turnUsage) return 0;
  return estimateCostUsdFromRates(turnUsage, rates);
}

/**
 * @param {import('knex').Knex} db
 * @param {string|null|undefined} modelId
 * @param {Record<string, string>|null|undefined} modelParams
 */
export async function resolveModelPricingRates(db, modelId, modelParams) {
  if (!modelId) return null;
  const overrides = await loadUsageModelPricingOverrides(db);
  const custom = overrides.get(modelId);
  if (custom) return custom;
  return lookupAgentModelPricing(modelId, modelParams ?? {});
}

/**
 * @param {import('knex').Knex} db
 * @param {Record<string, number>} turnUsage
 * @param {string|null|undefined} modelId
 * @param {unknown} modelParamsJson
 */
export async function estimateTurnCostUsd(db, turnUsage, modelId, modelParamsJson) {
  const rates = await resolveModelPricingRates(db, modelId, parseModelParamsJson(modelParamsJson));
  if (!rates || !turnUsage) return 0;
  return estimateCostUsdFromRates(turnUsage, rates);
}

/**
 * @param {import('knex').Knex} db
 * @param {string} modelId
 */
export async function pricingSourceForModel(db, modelId) {
  const overrides = await loadUsageModelPricingOverrides(db);
  const custom = overrides.get(modelId);
  if (custom) return { source: 'custom', rates: custom, editable: true };
  const builtin = lookupAgentModelPricing(modelId, {});
  if (builtin) return { source: 'builtin', rates: builtin, editable: true };
  return { source: 'missing', rates: null, editable: true };
}
