import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureSsePauseAndReconnect } from '../sseClientLifecycle.js';

function createHarness({ visibility = 'visible', online = true } = {}) {
  const listeners = {
    visibilitychange: [],
    online: [],
    offline: [],
  };
  const sseListeners = {
    reconnecting: [],
    disconnected: [],
    connected: [],
  };
  const state = { visibility, online };

  const documentStub = {
    addEventListener: (event, fn) => listeners[event]?.push(fn),
    removeEventListener: (event, fn) => {
      listeners[event] = (listeners[event] || []).filter((handler) => handler !== fn);
    },
  };
  const windowStub = {
    addEventListener: (event, fn) => listeners[event]?.push(fn),
    removeEventListener: (event, fn) => {
      listeners[event] = (listeners[event] || []).filter((handler) => handler !== fn);
    },
  };
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', windowStub);

  let current = new AbortController();
  const app = {
    teardown: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    service: () => ({
      on: (event, fn) => sseListeners[event]?.push(fn),
      removeListener: (event, fn) => {
        sseListeners[event] = (sseListeners[event] || []).filter((handler) => handler !== fn);
      },
    }),
  };

  const lifecycle = configureSsePauseAndReconnect({
    app,
    getAbortController: () => current,
    clearAbortController: () => {
      current = null;
    },
    shouldConnect: () => true,
    reconnectDelayMs: 0,
    getVisibility: () => state.visibility,
    getOnline: () => state.online,
  });

  return {
    app,
    listeners,
    sseListeners,
    getController: () => current,
    setController: (controller) => {
      current = controller;
    },
    lifecycle,
    state,
  };
}

describe('configureSsePauseAndReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('cancels the built-in sseClient reconnect timer when a drop happens while hidden', () => {
    const harness = createHarness({ visibility: 'hidden' });
    harness.lifecycle.start();

    let reconnectFired = false;
    const timeout = setTimeout(() => {
      reconnectFired = true;
    }, 1000);

    for (const handler of harness.sseListeners.reconnecting) {
      handler({ delay: 1000, attempt: 1, timeout });
    }

    vi.advanceTimersByTime(2000);
    expect(reconnectFired).toBe(false);
  });

  it('aborts a stream that connects while the tab is hidden', () => {
    const harness = createHarness({ visibility: 'hidden' });
    harness.lifecycle.start();
    const controller = new AbortController();
    harness.setController(controller);

    for (const handler of harness.sseListeners.connected) {
      handler(controller);
    }

    expect(controller.signal.aborted).toBe(true);
  });

  it('does not abort when reconnecting while the tab is visible and online', () => {
    const harness = createHarness({ visibility: 'visible' });
    harness.lifecycle.start();
    const controller = harness.getController();

    let reconnectFired = false;
    const timeout = setTimeout(() => {
      reconnectFired = true;
    }, 1000);

    for (const handler of harness.sseListeners.reconnecting) {
      handler({ delay: 1000, attempt: 1, timeout });
    }
    vi.advanceTimersByTime(2000);

    expect(reconnectFired).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(harness.app.teardown).not.toHaveBeenCalled();
  });

  it('aborts the open stream when the tab is hidden', () => {
    const harness = createHarness({ visibility: 'visible' });
    harness.lifecycle.start();
    const controller = harness.getController();

    harness.state.visibility = 'hidden';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }

    expect(controller.signal.aborted).toBe(true);
  });

  it('reopens via teardown/setup when a hidden drop later becomes visible', async () => {
    const harness = createHarness({ visibility: 'hidden' });
    harness.lifecycle.start();

    harness.getController().abort();
    for (const handler of harness.sseListeners.disconnected) {
      handler(new Error('stream dropped'));
    }

    harness.state.visibility = 'visible';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }

    await Promise.resolve();
    expect(harness.app.teardown).toHaveBeenCalledTimes(1);
    expect(harness.app.setup).toHaveBeenCalledTimes(1);
  });
});
