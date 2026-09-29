/**
 * Cursor SDK token adjustment (`usage.raw_token_usage` + derived columns).
 *
 * ## What the SDK docs claim
 *
 * Cursor's TypeScript SDK documents `TokenUsage` as four *disjoint* prompt-side
 * buckets plus output:
 *
 *   - `inputTokens` — prompt tokens sent to the model (uncached).
 *   - `cacheReadTokens` — tokens served from the prompt cache.
 *   - `cacheWriteTokens` — tokens written to the prompt cache.
 *   - `totalTokens` — `inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`
 *     (reasoning is a subset of output and excluded from total).
 *
 * Stream `usage` events (`SDKUsageMessage`) are described as per-turn deltas, while
 * `run.usage` / `result.usage` are cumulative across the run. Baguette accumulates
 * per-turn `usage` messages in `addTokenUsage()` before persisting.
 *
 * ## What we actually see in production
 *
 * Comparing stream totals to https://cursor.com/dashboard/usage shows a systematic
 * mismatch on **input**, not on cache write:
 *
 *   - From the SDK stream, `inputTokens` and `cacheReadTokens` are often the same order
 *     of magnitude and frequently nearly equal for a turn.
 *   - On Cursor's usage report, **Input** for the same work is typically an order of
 *     magnitude *lower* than **Cache read** (uncached prompt is tiny; most prompt mass
 *     is billed as cache read at the cheaper rate).
 *
 * Treating stream `input_tokens` as inclusive of cache read and using
 * `input_tokens - cache_read_tokens` for uncached prompt aligns Baguette's **Input**
 * column with what Cursor's web usage UI shows for the same turns.
 *
 * We persist the SDK stream verbatim in `usage.raw_token_usage` (JSON). The scalar
 * columns `input_tokens` and `total_tokens` on Cursor rows are *derived* for dashboard
 * parity and cost estimation; other buckets (`output_tokens`, `cache_*`, `reasoning_*`)
 * are stored as reported.
 *
 * ## Derivation rules
 *
 * When raw `input_tokens >= cache_read_tokens`, treat input as inclusive of cache read:
 *
 *   derived_input = input - cache_read
 *   derived_total = total + derived_input - input   (= total - cache_read)
 *
 * When raw `input_tokens < cache_read_tokens`, input already looks uncached; keep input
 * and total from the raw snapshot.
 *
 * @see server/services/turn-usage.js `addTokenUsage` — accumulates raw SDK fields.
 * @see server/lib/cursor-usage-row-cost.js — prices derived `input_tokens`.
 */

const RAW_TOKEN_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
  'total_tokens',
];

/**
 * @param {Record<string, unknown>} usage
 * @returns {Record<string, number>}
 */
export function buildCursorRawTokenUsage(usage) {
  const raw = {};
  for (const key of RAW_TOKEN_FIELDS) {
    raw[key] = Number(usage[key]) || 0;
  }
  return raw;
}

/**
 * @param {string|null|undefined} json
 * @returns {Record<string, number>|null}
 */
export function parseCursorRawTokenUsage(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return buildCursorRawTokenUsage(parsed);
  } catch {
    return null;
  }
}

/**
 * Uncached prompt tokens for Cursor billing / dashboard parity.
 *
 * @param {{ input_tokens?: number, cache_read_tokens?: number }} usage
 */
export function cursorBillingInputTokens(usage) {
  const input = Number(usage.input_tokens) || 0;
  const cacheRead = Number(usage.cache_read_tokens) || 0;
  if (input >= cacheRead) return Math.max(0, input - cacheRead);
  return input;
}

/**
 * @param {Record<string, number>} raw from `buildCursorRawTokenUsage` / `parseCursorRawTokenUsage`
 * @returns {{ input_tokens: number, total_tokens: number }}
 */
export function deriveCursorUsageFromRaw(raw) {
  const input = Number(raw.input_tokens) || 0;
  const total = Number(raw.total_tokens) || 0;
  const input_tokens = cursorBillingInputTokens(raw);
  const total_tokens = total + input_tokens - input;
  return { input_tokens, total_tokens };
}

/**
 * Snapshot raw SDK buckets to `raw_token_usage` and overwrite `input_tokens` /
 * `total_tokens` with derived values on the turn object (in place).
 *
 * @param {Record<string, unknown>} turnUsage
 */
export function applyCursorUsageDerivation(turnUsage) {
  const raw = buildCursorRawTokenUsage(turnUsage);
  const derived = deriveCursorUsageFromRaw(raw);
  turnUsage.raw_token_usage = JSON.stringify(raw);
  turnUsage.input_tokens = derived.input_tokens;
  turnUsage.total_tokens = derived.total_tokens;
  return turnUsage;
}
