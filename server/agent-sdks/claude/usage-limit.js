import logger from '../../logger.js';
import { parseUsageLimitResetMs } from '../../lib/usage-limit.js';
import { estimateAgentTurnCostUsd } from '../../../shared/agent-model-pricing.js';

/** Epoch ms from a rate-limit `resetsAt` (epoch seconds or millis). */
export function claudeResetsAtMs(resetsAt) {
  if (resetsAt == null) return null;
  const ms = resetsAt > 1e11 ? resetsAt : resetsAt * 1000;
  return Number.isNaN(new Date(ms).getTime()) ? null : ms;
}

const LIMIT_TEXT_PATTERN = /usage limit|hit your limit|limit reached/i;

/** Limit text on a failed `result` (the CLI can end a turn this way without a rejected event). */
function resultLimitText(message) {
  if (!message.is_error) return null;
  const text = [message.result, ...(message.errors ?? [])].filter(Boolean).join(' ');
  return LIMIT_TEXT_PATTERN.test(text) ? text : null;
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
   * @param {{ overage?: boolean, usageLimitUsd?: number | null }} [options] `usageLimitUsd` null = unlimited
   */
  constructor({ overage = true, usageLimitUsd = null } = {}) {
    this.overage = overage;
    this.usageLimitUsd = usageLimitUsd;
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
      if (message.type === 'assistant') return this.#onAssistant(message);
      if (message.type === 'result') return this.#onResult(message);
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
    if (resetMs) this.resetAtMs = resetMs;

    if (info.status === 'rejected') return { reason: 'rejected', resetAtMs: this.resetAtMs };

    if ((info.isUsingOverage || info.overageInUse) && !this.overageActive) {
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
    if (this.usageLimitUsd == null || this.spentUsd < this.usageLimitUsd) return null;
    return { reason: 'usage_limit', resetAtMs: this.resetAtMs };
  }
}
