import { describe, it, expect } from 'vitest';
import { ClaudeUsageLimitGuard, claudeResetsAtMs } from '../usage-limit.js';
import { processClaudeQueryStream } from '../sdk-turn.ts';

const limitEvent = (info) => ({ type: 'rate_limit_event', rate_limit_info: info });
// Sonnet-class pricing: 1M output tokens is well over a dollar.
const assistant = (id, outputTokens, model = 'claude-sonnet-4-5') => ({
  type: 'assistant',
  message: { id, model, content: [], usage: { input_tokens: 0, output_tokens: outputTokens } },
});
const result = (total) => ({ type: 'result', subtype: 'success', total_cost_usd: total });

describe('claudeResetsAtMs', () => {
  it('accepts epoch seconds and millis', () => {
    expect(claudeResetsAtMs(1793064000)).toBe(1793064000_000);
    expect(claudeResetsAtMs(1793064000_000)).toBe(1793064000_000);
    expect(claudeResetsAtMs(undefined)).toBeNull();
  });
});

describe('ClaudeUsageLimitGuard', () => {
  it('trips on a rejected limit with the reset time', () => {
    const guard = new ClaudeUsageLimitGuard();
    expect(guard.observe(limitEvent({ status: 'rejected', resetsAt: 1793064000 }))).toEqual({
      reason: 'rejected',
      resetAtMs: 1793064000_000,
    });
  });

  it('ignores allowed events', () => {
    const guard = new ClaudeUsageLimitGuard();
    expect(guard.observe(limitEvent({ status: 'allowed', rateLimitType: 'five_hour' }))).toBeNull();
  });

  it('trips immediately on overage when the session forbids it', () => {
    const guard = new ClaudeUsageLimitGuard({ overage: false });
    const hit = guard.observe(
      limitEvent({ status: 'allowed', isUsingOverage: true, resetsAt: 1793064000 })
    );
    expect(hit).toEqual({ reason: 'overage_disabled', resetAtMs: 1793064000_000 });
  });

  it('allows overage up to the usage limit, then trips', () => {
    const guard = new ClaudeUsageLimitGuard({ overage: true, usageLimitUsd: 1 });
    expect(guard.observe(limitEvent({ status: 'allowed', isUsingOverage: true }))).toBeNull();
    // ~ $0.30 at sonnet output rates: under budget.
    expect(guard.observe(assistant('a', 20_000))).toBeNull();
    // Same message id repeated per content block must not double count.
    expect(guard.observe(assistant('a', 20_000))).toBeNull();
    const before = guard.spentUsd;
    expect(before).toBeGreaterThan(0);
    expect(guard.observe(assistant('b', 1_000_000))).toMatchObject({ reason: 'usage_limit' });
  });

  it('trips on a failed result that carries usage-limit text', () => {
    const guard = new ClaudeUsageLimitGuard();
    const hit = guard.observe({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['You have hit your usage limit. Try again in 2 hours.'],
    });
    expect(hit.reason).toBe('rejected');
    expect(hit.resetAtMs).toBeGreaterThan(Date.now() + 119 * 60_000);
    expect(
      guard.observe({ type: 'result', subtype: 'error', is_error: true, errors: ['boom'] })
    ).toBeNull();
  });

  it('never trips on spend when the usage limit is null (unlimited)', () => {
    const guard = new ClaudeUsageLimitGuard({ overage: true, usageLimitUsd: null });
    guard.observe(limitEvent({ status: 'allowed', isUsingOverage: true }));
    expect(guard.observe(assistant('big', 5_000_000))).toBeNull();
    expect(guard.observe(result(500))).toBeNull();
  });

  it('honours a usage limit below one dollar', () => {
    const guard = new ClaudeUsageLimitGuard({ overage: true, usageLimitUsd: 0.1 });
    guard.observe(limitEvent({ status: 'allowed', isUsingOverage: true }));
    // 20k sonnet output tokens ≈ $0.30, over the 10 cent limit.
    expect(guard.observe(assistant('a', 20_000))).toMatchObject({ reason: 'usage_limit' });
  });

  it('does not count spend before overage starts', () => {
    const guard = new ClaudeUsageLimitGuard();
    expect(guard.observe(assistant('a', 5_000_000))).toBeNull();
    expect(guard.spentUsd).toBe(0);
  });

  it('uses the cumulative result cost since overage began', () => {
    const guard = new ClaudeUsageLimitGuard({ usageLimitUsd: 1 });
    guard.observe(result(5)); // spend before overage = baseline
    guard.observe(limitEvent({ status: 'allowed', isUsingOverage: true }));
    expect(guard.observe(result(5.4))).toBeNull();
    expect(guard.observe(result(6.2))).toMatchObject({ reason: 'usage_limit' });
  });
});

describe('ClaudeUsageLimitGuard session budget and reset time', () => {
  it('counts overage spent in earlier turns against the usage limit', () => {
    const fresh = new ClaudeUsageLimitGuard({ overage: true, usageLimitUsd: 1 });
    fresh.observe(limitEvent({ status: 'allowed', isUsingOverage: true }));
    expect(fresh.observe(assistant('a', 20_000))).toBeNull();

    const later = new ClaudeUsageLimitGuard({
      overage: true,
      usageLimitUsd: 1,
      priorSpentUsd: 0.9,
    });
    later.observe(limitEvent({ status: 'allowed', isUsingOverage: true }));
    expect(later.observe(assistant('a', 20_000))).toMatchObject({ reason: 'usage_limit' });
  });

  it('does not take the reset time from an allowed/warning event', () => {
    const guard = new ClaudeUsageLimitGuard();
    guard.observe(limitEvent({ status: 'allowed_warning', resetsAt: 4_000_000_000 }));
    const hit = guard.observe({
      type: 'result',
      is_error: true,
      result: 'You have hit your limit',
    });
    expect(hit).toMatchObject({ reason: 'rejected', resetAtMs: null });
  });

  it('reports tokens used since the last result for a turn cut mid-stream', () => {
    const guard = new ClaudeUsageLimitGuard();
    guard.observe(assistant('a', 100));
    guard.observe(assistant('a', 100));
    guard.observe(result(0.01));
    expect(guard.partialModelUsageSinceResult()).toBeNull();
    guard.observe(assistant('b', 250));
    expect(guard.partialModelUsageSinceResult()).toEqual({
      'claude-sonnet-4-5': {
        inputTokens: 0,
        outputTokens: 250,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
  });
});

describe('processClaudeQueryStream usage guard', () => {
  async function* stream(messages) {
    for (const m of messages) yield m;
  }

  it('stops reading the stream when the guard trips and reports the limit', async () => {
    const guard = new ClaudeUsageLimitGuard();
    const persisted = [];
    const out = await processClaudeQueryStream(
      stream([
        { type: 'system', subtype: 'init', session_id: 's' },
        limitEvent({ status: 'rejected', resetsAt: 1793064000 }),
        assistant('never', 10),
      ]),
      { usageGuard: guard, persistMessage: async (m) => void persisted.push(m.type) }
    );
    expect(out.usageLimit).toEqual({ reason: 'rejected', resetAtMs: 1793064000_000 });
    expect(out.outcome).toBe('stopped');
    // The tripping rate-limit event is not persisted; the session notice replaces it.
    expect(persisted).toEqual(['system']);
  });

  it('reports no limit for a normal turn', async () => {
    const out = await processClaudeQueryStream(
      stream([{ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok' }]),
      { usageGuard: new ClaudeUsageLimitGuard(), persistMessage: async () => {} }
    );
    expect(out.usageLimit).toBeNull();
    expect(out.outcome).toBe('completed');
  });
});
