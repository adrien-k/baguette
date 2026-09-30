import { describe, expect, it, vi } from 'vitest';
import { notifySseReconnect, subscribeSseReconnect } from '../sseReconnect.js';

describe('sseReconnect', () => {
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
    subscribeSseReconnect(() => {
      throw new Error('boom');
    });
    subscribeSseReconnect(good);
    expect(() => notifySseReconnect()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
