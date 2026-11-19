// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  notifySseReconnect,
  notifySseStreamPaused,
  subscribeSseReconnect,
  subscribeSseStreamPaused,
} from '../sseReconnect.js';

describe('sseReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies subscribers on reconnect', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSseReconnect(listener);
    notifySseReconnect();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifySseReconnect();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates listener errors', () => {
    const good = vi.fn();
    const unsubscribeBad = subscribeSseReconnect(() => {
      throw new Error('boom');
    });
    const unsubscribeGood = subscribeSseReconnect(good);
    expect(() => notifySseReconnect()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    unsubscribeBad();
    unsubscribeGood();
  });

  it('notifies pause subscribers when the SSE stream is paused', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSseStreamPaused(listener);
    notifySseStreamPaused();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifySseStreamPaused();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
