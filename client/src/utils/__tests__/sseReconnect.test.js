import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  flushSseReconnectNotifyForTests,
  notifySseReconnect,
  subscribeSseReconnect,
} from '../sseReconnect.js';

describe('sseReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    flushSseReconnectNotifyForTests();
    vi.useRealTimers();
  });

  it('notifies subscribers on reconnect', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSseReconnect(listener);
    notifySseReconnect();
    vi.runAllTimers();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifySseReconnect();
    vi.runAllTimers();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid reconnect notifications', () => {
    const listener = vi.fn();
    subscribeSseReconnect(listener);
    notifySseReconnect();
    notifySseReconnect();
    notifySseReconnect();
    vi.runAllTimers();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates listener errors', () => {
    const good = vi.fn();
    subscribeSseReconnect(() => {
      throw new Error('boom');
    });
    subscribeSseReconnect(good);
    expect(() => {
      notifySseReconnect();
      vi.runAllTimers();
    }).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
