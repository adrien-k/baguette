/**
 * Cursor model list prices (USD per 1M tokens): input, cache write, cache read, output.
 * Used to estimate Cursor session cost from per-turn token counts. Baguette does not
 * read USD from `agent.getUsage()` — local agents (what we run) return
 * `feature_unavailable` for that endpoint, so this table is the only cost source.
 *
 * PRICING_RULES below was generated from a copy-paste of
 * https://cursor.com/docs/models-and-pricing — update manually when Cursor changes rates.
 */

const M = 1_000_000;

/** @param {number} input @param {number|null|undefined} cacheWrite @param {number|null|undefined} cacheRead @param {number} output */
function rates(input, cacheWrite, cacheRead, output) {
  return {
    input,
    cacheWrite: cacheWrite ?? null,
    cacheRead: cacheRead ?? null,
    output,
  };
}

/**
 * @typedef {{ modelIds: string[], match?: Record<string, string>, rates: ReturnType<typeof rates> }} PricingRule
 */

/** More specific rules (more match keys) must sort before broader ones. */
const PRICING_RULES = [
  // Cursor — Grok 4.7
  {
    modelIds: ['grok-4.7'],
    match: { context: '500k', fast: 'true' },
    rates: rates(6, null, 1.5, 18),
  },
  {
    modelIds: ['grok-4.7'],
    match: { context: '500k', fast: 'false' },
    rates: rates(4, null, 1, 12),
  },
  { modelIds: ['grok-4.7'], match: { fast: 'true' }, rates: rates(4, null, 1, 12) },
  { modelIds: ['grok-4.7'], match: { fast: 'false' }, rates: rates(2, null, 0.5, 6) },
  { modelIds: ['grok-4.7'], match: {}, rates: rates(2, null, 0.5, 6) },
  // Grok 4.6
  { modelIds: ['grok-4.6'], match: { fast: 'true' }, rates: rates(4, null, 1, 12) },
  { modelIds: ['grok-4.6'], match: { fast: 'false' }, rates: rates(2, null, 0.5, 6) },
  { modelIds: ['grok-4.6'], match: {}, rates: rates(2, null, 0.5, 6) },
  // Grok 4.5
  { modelIds: ['grok-4.5'], match: { fast: 'true' }, rates: rates(4, null, 1, 18) },
  { modelIds: ['grok-4.5'], match: { fast: 'false' }, rates: rates(2, null, 0.5, 6) },
  { modelIds: ['grok-4.5'], match: {}, rates: rates(2, null, 0.5, 6) },
  // Composer 2.5
  { modelIds: ['composer-2.5'], match: { fast: 'true' }, rates: rates(3, null, 0.5, 15) },
  { modelIds: ['composer-2.5'], match: { fast: 'false' }, rates: rates(0.5, null, 0.2, 2.5) },
  { modelIds: ['composer-2.5'], match: {}, rates: rates(0.5, null, 0.2, 2.5) },

  // Anthropic
  {
    modelIds: ['claude-sonnet-4', 'claude-sonnet-4-5', 'claude-sonnet-4-6'],
    match: { context: '1m' },
    rates: rates(6, 7.5, 0.6, 22.5),
  },
  {
    modelIds: ['claude-opus-4-7'],
    match: { fast: 'true' },
    rates: rates(30, 37.5, 3, 150),
  },
  { modelIds: ['claude-sonnet-4'], match: {}, rates: rates(3, 3.75, 0.3, 15) },
  { modelIds: ['claude-sonnet-4-5'], match: {}, rates: rates(3, 3.75, 0.3, 15) },
  { modelIds: ['claude-sonnet-4-6'], match: {}, rates: rates(3, 3.75, 0.3, 15) },
  { modelIds: ['claude-sonnet-5', 'claude-sonnet-5-5'], match: {}, rates: rates(2, 2.5, 0.2, 10) },
  { modelIds: ['claude-haiku-4-5'], match: {}, rates: rates(1, 1.25, 0.1, 5) },
  { modelIds: ['claude-opus-4-5'], match: {}, rates: rates(5, 6.25, 0.5, 25) },
  { modelIds: ['claude-opus-4-6'], match: {}, rates: rates(5, 6.25, 0.5, 25) },
  { modelIds: ['claude-opus-4-7'], match: {}, rates: rates(5, 6.25, 0.5, 25) },
  { modelIds: ['claude-opus-4-8'], match: {}, rates: rates(5, 6.25, 0.5, 25) },
  { modelIds: ['claude-opus-5'], match: {}, rates: rates(5, 6.25, 0.5, 25) },
  { modelIds: ['claude-opus-5-5'], match: {}, rates: rates(4, 5, 0.2, 20) },
  { modelIds: ['claude-fable-5'], match: {}, rates: rates(10, 12.5, 1, 50) },
  { modelIds: ['claude-fable-5-1'], match: {}, rates: rates(10, 12.5, 0.25, 50) },

  // Google
  { modelIds: ['gemini-2.5-flash'], match: {}, rates: rates(0.3, null, 0.03, 2.5) },
  { modelIds: ['gemini-3-flash'], match: {}, rates: rates(0.5, null, 0.05, 3) },
  { modelIds: ['gemini-3-pro'], match: {}, rates: rates(2, null, 0.2, 12) },
  { modelIds: ['gemini-3-pro-image-preview'], match: {}, rates: rates(2, null, 0.2, 12) },
  { modelIds: ['gemini-3.1-pro'], match: {}, rates: rates(2, null, 0.2, 12) },
  { modelIds: ['gemini-3.5-flash'], match: {}, rates: rates(1.5, null, 0.15, 9) },
  { modelIds: ['gemini-3.6-flash'], match: {}, rates: rates(1.5, null, 0.15, 7.5) },
  { modelIds: ['gemini-3.7-flash'], match: {}, rates: rates(0.75, null, 0.075, 3.5) },
  { modelIds: ['gemini-3.8-flash'], match: {}, rates: rates(0.75, null, 0.075, 3.5) },

  // Z.ai
  { modelIds: ['glm-5.2'], match: {}, rates: rates(1.4, null, 0.26, 4.4) },

  // OpenAI
  { modelIds: ['gpt-5'], match: {}, rates: rates(1.25, null, 0.125, 10) },
  { modelIds: ['gpt-5-fast'], match: {}, rates: rates(2.5, null, 0.25, 20) },
  { modelIds: ['gpt-5-mini'], match: {}, rates: rates(0.25, null, 0.025, 2) },
  { modelIds: ['gpt-5-codex'], match: {}, rates: rates(1.25, null, 0.125, 10) },
  { modelIds: ['gpt-5.1-codex'], match: {}, rates: rates(1.25, null, 0.125, 10) },
  { modelIds: ['gpt-5.1-codex-max'], match: {}, rates: rates(1.25, null, 0.125, 10) },
  { modelIds: ['gpt-5.1-codex-mini'], match: {}, rates: rates(0.25, null, 0.025, 2) },
  { modelIds: ['gpt-5.2'], match: {}, rates: rates(1.75, null, 0.175, 14) },
  { modelIds: ['gpt-5.2-codex'], match: {}, rates: rates(1.75, null, 0.175, 14) },
  { modelIds: ['gpt-5.3-codex'], match: {}, rates: rates(1.75, null, 0.175, 14) },
  { modelIds: ['gpt-5.4'], match: {}, rates: rates(2.5, null, 0.25, 15) },
  { modelIds: ['gpt-5.4-mini'], match: {}, rates: rates(0.75, null, 0.075, 4.5) },
  { modelIds: ['gpt-5.4-nano'], match: {}, rates: rates(0.2, null, 0.02, 1.25) },
  { modelIds: ['gpt-5.5'], match: {}, rates: rates(5, null, 0.5, 30) },
  { modelIds: ['gpt-5.6-luna'], match: {}, rates: rates(0.2, 0.25, 0.02, 1.2) },
  { modelIds: ['gpt-5.6-sol'], match: {}, rates: rates(4, 5, 0.4, 20) },
  { modelIds: ['gpt-5.6-terra'], match: {}, rates: rates(2, 2.5, 0.2, 12) },
  { modelIds: ['gpt-5.1'], match: {}, rates: rates(1.25, null, 0.125, 10) },

  // Moonshot
  { modelIds: ['kimi-k2.7-code'], match: {}, rates: rates(0.95, null, 0.19, 4) },
  { modelIds: ['kimi-k3'], match: {}, rates: rates(3, null, 0.3, 15) },

  // Meta
  { modelIds: ['muse-spark-1.3'], match: {}, rates: rates(1.25, null, 0.15, 4.25) },
];

function normalizeParamValue(id, value) {
  if (value == null) return '';
  if (id === 'context') return String(value).trim().toLowerCase();
  return String(value);
}

/** @param {string|null|undefined} raw JSON array of `{ id, value }` from sessions.model_params */
export function parseModelParamsJson(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const map = {};
    for (const p of parsed) {
      if (p?.id != null) map[p.id] = normalizeParamValue(p.id, p.value);
    }
    return map;
  } catch {
    return {};
  }
}

/** @param {{ id: string, value: string }[]|null|undefined} params */
export function paramMapFromParamsArray(params) {
  if (!params?.length) return {};
  const map = {};
  for (const p of params) {
    if (p?.id != null) map[p.id] = normalizeParamValue(p.id, p.value);
  }
  return map;
}

function ruleSpecificity(rule) {
  return Object.keys(rule.match ?? {}).length;
}

function ruleMatches(rule, modelId, pmap) {
  if (!modelId || !rule.modelIds.includes(modelId)) return false;
  for (const [key, expected] of Object.entries(rule.match ?? {})) {
    const actual = pmap[key];
    if (normalizeParamValue(key, actual) !== normalizeParamValue(key, expected)) return false;
  }
  return true;
}

/**
 * @param {string|null|undefined} modelId
 * @param {Record<string, string>|{ id: string, value: string }[]|null|undefined} modelParams
 * @returns {PricingRule['rates']|null}
 */
export function lookupCursorModelPricing(modelId, modelParams) {
  if (!modelId) return null;
  const pmap = Array.isArray(modelParams)
    ? paramMapFromParamsArray(modelParams)
    : (modelParams ?? {});

  const candidates = PRICING_RULES.filter((rule) => ruleMatches(rule, modelId, pmap));
  if (!candidates.length) return null;
  candidates.sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a));
  return candidates[0].rates;
}

export function hasCursorModelPricing(modelId, modelParams) {
  return lookupCursorModelPricing(modelId, modelParams) != null;
}

/** @param {Record<string, number>} turnUsage @param {ReturnType<typeof rates>} priceRates */
export function estimateCostUsdFromRates(turnUsage, priceRates) {
  if (!priceRates || !turnUsage) return 0;
  let cost = 0;
  cost += ((turnUsage.input_tokens ?? 0) * priceRates.input) / M;
  if (priceRates.cacheWrite != null) {
    cost += ((turnUsage.cache_write_tokens ?? 0) * priceRates.cacheWrite) / M;
  }
  if (priceRates.cacheRead != null) {
    cost += ((turnUsage.cache_read_tokens ?? 0) * priceRates.cacheRead) / M;
  }
  // Reasoning tokens are a subset of output in the Cursor SDK; do not bill separately.
  cost += ((turnUsage.output_tokens ?? 0) * priceRates.output) / M;
  return cost;
}

/**
 * @returns {number|null} Turn cost in USD, or null when the model is not in the pricing table.
 */
export function estimateCursorTurnCostUsd(turnUsage, modelId, modelParams) {
  const priceRates = lookupCursorModelPricing(modelId, modelParams);
  if (!priceRates) return null;
  return estimateCostUsdFromRates(turnUsage, priceRates);
}
