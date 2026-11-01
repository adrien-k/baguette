/**
 * Last Claude SDK `result` running `modelUsage` per key, for differencing the
 * next one. Held in memory only: a restart also restarts the agent's own
 * counters, so an absent entry and a reset counter line up.
 *
 * Keys are `session.id` for chat and `reviewTurnKey(agent.id)` for review.
 */
const lastResultTotals = new Map();

export function getLastResultTotals(key) {
  return lastResultTotals.get(key) ?? { models: {} };
}

export function setLastResultTotals(key, totals) {
  lastResultTotals.set(key, totals);
}

/** Drop stored running totals for a chat session or review turn. */
export function resetUsageTotals(totalsKey) {
  lastResultTotals.delete(totalsKey);
}

/** Test helper: session ids reuse across truncated DBs in the same process. */
export function clearAllUsageTotals() {
  lastResultTotals.clear();
}
