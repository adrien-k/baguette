import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureSsePauseAndReconnect } from '../sseClientLifecycle.js';
import {
  consumeSkipSseReconnectRefetch,
  resetSseReconnectStateForTests,
  subscribeSseResumeCatchUp,
  subscribeSseStreamPaused,
} from '../sseReconnect.js';

function createHarness({ visibility = 'visible', online = true, reconnectDelayMs = 0 } = {}) {
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
    setup: vi.fn().mockImplementation(async () => {
      current = new AbortController();
    }),
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
    reconnectDelayMs,
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
    resetSseReconnectStateForTests();
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

    await vi.waitFor(() => expect(harness.app.teardown).toHaveBeenCalledTimes(1));
    expect(harness.app.setup).toHaveBeenCalledTimes(1);
  });

  it('notifies pause when the stream drops while the tab is hidden', () => {
    const onPause = vi.fn();
    const unsubscribe = subscribeSseStreamPaused(onPause);
    const harness = createHarness({ visibility: 'hidden' });
    harness.lifecycle.start();
    for (const handler of harness.sseListeners.disconnected) {
      handler(new Error('stream dropped'));
    }
    expect(onPause).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('runs resume catch-up before app.setup when the tab becomes visible', async () => {
    const order = [];
    const unsubscribe = subscribeSseResumeCatchUp(async () => {
      order.push('catch-up');
    });
    const harness = createHarness({ visibility: 'hidden' });
    harness.app.teardown = vi.fn().mockImplementation(async () => {
      order.push('teardown');
    });
    harness.app.setup = vi.fn().mockImplementation(async () => {
      order.push('setup');
      harness.setController(new AbortController());
    });
    harness.lifecycle.start();
    harness.getController().abort();
    for (const handler of harness.sseListeners.disconnected) {
      handler(new Error('stream dropped'));
    }
    harness.state.visibility = 'visible';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    await vi.waitFor(() => expect(order).toEqual(['catch-up', 'teardown', 'setup']));
    unsubscribe();
  });

  it('waits out the resume delay before catch-up, then opens the stream immediately', async () => {
    const order = [];
    const unsubscribe = subscribeSseResumeCatchUp(async () => {
      order.push('catch-up');
    });
    const harness = createHarness({ visibility: 'hidden', reconnectDelayMs: 500 });
    harness.app.teardown = vi.fn().mockImplementation(async () => {
      order.push('teardown');
    });
    harness.app.setup = vi.fn().mockImplementation(async () => {
      order.push('setup');
      harness.setController(new AbortController());
    });
    harness.lifecycle.start();
    harness.getController().abort();
    for (const handler of harness.sseListeners.disconnected) {
      handler(new Error('stream dropped'));
    }
    harness.state.visibility = 'visible';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    await vi.advanceTimersByTimeAsync(499);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(order).toEqual(['catch-up', 'teardown', 'setup']));
    unsubscribe();
  });

  it('can reconnect after the tab hides during the resume delay', async () => {
    const harness = createHarness({ visibility: 'hidden', reconnectDelayMs: 500 });
    harness.lifecycle.start();
    harness.getController().abort();
    for (const handler of harness.sseListeners.disconnected) {
      handler(new Error('stream dropped'));
    }
    harness.state.visibility = 'visible';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    await vi.advanceTimersByTimeAsync(200);
    harness.state.visibility = 'hidden';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    expect(consumeSkipSseReconnectRefetch()).toBe(false);
    harness.state.visibility = 'visible';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(harness.app.setup).toHaveBeenCalledTimes(1));
  });

  it('reconnects when the tab is shown again after hiding during setup', async () => {
    let releaseSetup;
    const setupGate = new Promise((resolve) => {
      releaseSetup = resolve;
    });
    const harness = createHarness({ visibility: 'hidden' });
    harness.app.setup = vi.fn().mockImplementation(() => {
      if (harness.app.setup.mock.calls.length === 1) return setupGate;
      harness.setController(new AbortController());
      return Promise.resolve();
    });
    harness.lifecycle.start();
    harness.getController().abort();
    for (const handler of harness.sseListeners.disconnected) {
      handler(new Error('stream dropped'));
    }

    harness.state.visibility = 'visible';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    await vi.waitFor(() => expect(harness.app.setup).toHaveBeenCalledTimes(1));

    harness.state.visibility = 'hidden';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    releaseSetup();
    await setupGate;
    await Promise.resolve();

    harness.state.visibility = 'visible';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    await vi.waitFor(() => expect(harness.app.setup).toHaveBeenCalledTimes(2));
  });

  it('does not tear down a setup that has not emitted connected yet', async () => {
    const harness = createHarness({ visibility: 'hidden', reconnectDelayMs: 500 });
    harness.app.setup = vi.fn().mockResolvedValue(undefined);
    harness.lifecycle.start();
    harness.getController().abort();
    for (const handler of harness.sseListeners.disconnected) {
      handler(new Error('stream dropped'));
    }

    harness.state.visibility = 'visible';
    for (const handler of harness.listeners.visibilitychange) {
      handler();
    }
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(harness.app.setup).toHaveBeenCalledTimes(1));
    expect(harness.app.teardown).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.app.teardown).toHaveBeenCalledTimes(1);
    expect(harness.app.setup).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    harness.setController(controller);
    for (const handler of harness.sseListeners.connected) {
      handler(controller);
    }
    expect(harness.app.teardown).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(false);
  });
});
