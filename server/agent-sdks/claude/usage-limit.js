import logger from '../../logger.js';
import { isUsageLimitText, parseUsageLimitResetMs } from '../../lib/usage-limit.js';
import { estimateAgentTurnCostUsd } from '../../../shared/agent-model-pricing.js';

/** Epoch ms from a rate-limit `resetsAt` (epoch seconds or millis). */
export function claudeResetsAtMs(resetsAt) {
  if (resetsAt == null) return null;
  const ms = resetsAt > 1e11 ? resetsAt : resetsAt * 1000;
  return Number.isNaN(new Date(ms).getTime()) ? null : ms;
}

/** Limit text on a failed `result` (the CLI can end a turn this way without a rejected event). */
function resultLimitText(message) {
  if (!message.is_error) return null;
  const text = [message.result, ...(message.errors ?? [])].filter(Boolean).join(' ');
  return isUsageLimitText(text) ? text : null;
}

function assistantCostUsd(message) {
  const usage = message.message?.usage;
  if (!usage) return 0;
  // Unknown models price at 0 here; the cumulative `result` cost still catches the spend.
  return (
    estimateAgentTurnCostUsd(
      {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      },
      message.message?.model,
      {}
    ) ?? 0
  );
}

/**
 * Watches one Claude query stream for usage limits.
 *
 * `observe(message)` returns `{ reason, resetAtMs }` once the turn must stop:
 *  - `rejected`: the subscription (and overage) refused the request;
 *  - `overage_disabled`: the plan started drawing paid overage but the session forbids it;
 *  - `usage_limit`: estimated spend since overage began reached the session's usage limit.
 * Spend counts every assistant message (subagents included) and is corrected upward from
 * the SDK's cumulative `total_cost_usd` on each `result`.
 */
export class ClaudeUsageLimitGuard {
  /**
   * @param {{ overage?: boolean, usageLimitUsd?: number | null, priorSpentUsd?: number }} [options]
   *   `usageLimitUsd` null = unlimited; `priorSpentUsd` is the overage the session spent in
   *   earlier turns, so the limit caps the whole session, not each turn.
   */
  constructor({ overage = true, usageLimitUsd = null, priorSpentUsd = 0 } = {}) {
    this.overage = overage;
    this.usageLimitUsd = usageLimitUsd;
    this.priorSpentUsd = Number(priorSpentUsd) > 0 ? Number(priorSpentUsd) : 0;
    /** Assistant messages since the last `result`, by id (a message repeats per content block). */
    this.sinceResult = new Map();
    this.overageActive = false;
    this.spentUsd = 0;
    this.lastTotalCostUsd = 0;
    this.baselineCostUsd = 0;
    this.resetAtMs = null;
    this.seenAssistantIds = new Set();
    this.warned = false;
  }

  /**
   * Fail-safe: the guard is an optional safety net, so an unexpected message shape (SDK
   * changes) must never break the turn — it just stops guarding that message.
   */
  observe(message) {
    try {
      if (message.type === 'rate_limit_event') return this.#onRateLimit(message.rate_limit_info);
      if (message.type === 'assistant') {
        const m = message.message;
        if (m?.usage && m.model) this.sinceResult.set(m.id ?? this.sinceResult.size, m);
        return this.#onAssistant(message);
      }
      if (message.type === 'result') {
        this.sinceResult.clear();
        return this.#onResult(message);
      }
    } catch (err) {
      // Logged once per turn: a broken shape would otherwise repeat for every message.
      if (!this.warned)
        logger.warn({ err: err?.message }, 'claude usage guard: unreadable message');
      this.warned = true;
    }
    return null;
  }

  #onRateLimit(info) {
    if (!info) return null;
    const resetMs = claudeResetsAtMs(info.resetsAt) ?? claudeResetsAtMs(info.overageResetsAt);
    const usingOverage = Boolean(info.isUsingOverage || info.overageInUse);

    // Only the event that actually stops the turn says when to resume. `allowed`/warning
    // events describe other windows (e.g. weekly) and must not become the reset time.
    if (info.status === 'rejected') {
      if (resetMs) this.resetAtMs = resetMs;
      return { reason: 'rejected', resetAtMs: this.resetAtMs };
    }

    if (usingOverage && !this.overageActive) {
      if (resetMs) this.resetAtMs = resetMs;
      this.overageActive = true;
      this.baselineCostUsd = this.lastTotalCostUsd;
      this.spentUsd = 0;
      if (!this.overage) return { reason: 'overage_disabled', resetAtMs: this.resetAtMs };
    }
    return null;
  }

  #onAssistant(message) {
    if (!this.overageActive) return null;
    const id = message.message?.id;
    // The SDK emits one assistant message per content block with identical usage.
    if (id) {
      if (this.seenAssistantIds.has(id)) return null;
      this.seenAssistantIds.add(id);
    }
    this.spentUsd += assistantCostUsd(message);
    return this.#checkBudget();
  }

  /**
   * Tokens of the turn since the last `result` as a `modelUsage` map, for a turn cut before its
   * own `result` arrived. Null when there is nothing to record.
   */
  partialModelUsageSinceResult() {
    if (!this.sinceResult.size) return null;
    const byModel = {};
    for (const { model, usage } of this.sinceResult.values()) {
      const into = (byModel[model] ??= {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      into.inputTokens += usage.input_tokens ?? 0;
      into.outputTokens += usage.output_tokens ?? 0;
      into.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
      into.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
    }
    return byModel;
  }

  #onResult(message) {
    const limitText = resultLimitText(message);
    if (limitText) {
      const parsed = parseUsageLimitResetMs(limitText);
      return { reason: 'rejected', resetAtMs: this.resetAtMs ?? parsed };
    }
    const total = message.total_cost_usd;
    if (typeof total !== 'number') return null;
    this.lastTotalCostUsd = total;
    if (!this.overageActive) return null;
    this.spentUsd = Math.max(this.spentUsd, total - this.baselineCostUsd);
    return this.#checkBudget();
  }

  #checkBudget() {
    if (this.usageLimitUsd == null) return null;
    if (this.priorSpentUsd + this.spentUsd < this.usageLimitUsd) return null;
    return { reason: 'usage_limit', resetAtMs: this.resetAtMs };
  }
}
