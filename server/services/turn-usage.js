/**
 * Pure helpers for turning an agent SDK's usage report into one `usage` row.
 *
 * Both SDKs report usage *cumulatively* rather than per turn:
 *
 *  - Cursor's `agent.getUsage()` totals the whole agent.
 *  - The Claude SDK's `total_cost_usd` and `modelUsage` are "cumulative across
 *    turns in streaming-input sessions — each result carries the running total so
 *    far, so read the latest result rather than summing across results". Baguette
 *    runs `query({ prompt: channel })` with an async-iterable channel, which is
 *    streaming-input mode, so this applies to every Claude session.
 *
 * So a turn's own figures are always a difference against the previous snapshot.
 * The counter also restarts from zero when a session is resumed on a fresh query,
 * which `delta()` detects and treats as a fresh start rather than a negative.
 */

/** A turn's token totals, keyed by `usage` table column name. */
export function emptyTurnUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    model: null,
  };
}

/**
 * This turn's share of a cumulative counter. A `next` below `prev` means the
 * counter restarted (a resumed session starts fresh), so all of it is new.
 */
export function delta(prev, next) {
  const from = Number(prev) || 0;
  const to = Number(next) || 0;
  return to >= from ? to - from : to;
}

/**
 * Add one Cursor `TokenUsage` payload into the accumulator. A turn can span
 * several runs — a background task schedules follow-ups, each ending with its own
 * `SDKUsageMessage` — so these accumulate rather than replace.
 */
export function addTokenUsage(acc, usage) {
  if (!usage) return acc;
  acc.input_tokens += usage.inputTokens ?? 0;
  acc.output_tokens += usage.outputTokens ?? 0;
  acc.cache_read_tokens += usage.cacheReadTokens ?? 0;
  acc.cache_write_tokens += usage.cacheWriteTokens ?? 0;
  acc.reasoning_tokens += usage.reasoningTokens ?? 0;
  // `totalTokens` excludes `reasoningTokens` (a subset of output), per the SDK.
  acc.total_tokens += usage.totalTokens ?? 0;
  return acc;
}

/**
 * Difference two cumulative `modelUsage` snapshots from the Claude SDK into this
 * turn's tokens. `model` is whichever model did the most token work this turn —
 * a turn can touch several (subagents, compaction), and the row holds one.
 *
 * `modelUsage` is the field the SDK names as correct for token accounting; the
 * sibling `usage` field covers the main agent loop only.
 */
export function diffModelUsage(prevModels = {}, nextModels = {}) {
  const turn = emptyTurnUsage();
  let topTokens = 0;

  for (const [model, next] of Object.entries(nextModels ?? {})) {
    const prev = prevModels?.[model] ?? {};
    const input = delta(prev.inputTokens, next.inputTokens);
    const output = delta(prev.outputTokens, next.outputTokens);
    const cacheRead = delta(prev.cacheReadInputTokens, next.cacheReadInputTokens);
    const cacheWrite = delta(prev.cacheCreationInputTokens, next.cacheCreationInputTokens);

    turn.input_tokens += input;
    turn.output_tokens += output;
    turn.cache_read_tokens += cacheRead;
    turn.cache_write_tokens += cacheWrite;

    // Match Cursor's `totalTokens`, which counts the tokens the model moved.
    const modelTotal = input + output + cacheRead + cacheWrite;
    turn.total_tokens += modelTotal;
    if (modelTotal > topTokens) {
      topTokens = modelTotal;
      turn.model = model;
    }
  }

  return turn;
}
