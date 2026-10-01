import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSseManager } from '../sseManager.js';

describe('createSseManager', () => {
  let visibility;
  let online;
  let instances;
  let EventSourceImpl;
  let docListeners;
  let winListeners;

  beforeEach(() => {
    visibility = 'visible';
    online = true;
    instances = [];
    docListeners = new Map();
    winListeners = new Map();

    EventSourceImpl = vi.fn(function FakeEventSource() {
      this.onmessage = null;
      this.onopen = null;
      this.close = vi.fn(() => {
        instances = instances.filter((s) => s !== this);
      });
      instances.push(this);
    });
  });

  function createManager(overrides = {}) {
    return createSseManager({
      url: '/api/events',
      onMessage: vi.fn(),
      onReconnect: vi.fn(),
      reconnectDelayMs: 0,
      getVisibility: () => visibility,
      getOnline: () => online,
      EventSourceImpl,
      addEventListener: (type, handler) => {
        if (!docListeners.has(type)) docListeners.set(type, new Set());
        docListeners.get(type).add(handler);
      },
      removeEventListener: (type, handler) => {
        docListeners.get(type)?.delete(handler);
      },
      addWindowListener: (type, handler) => {
        if (!winListeners.has(type)) winListeners.set(type, new Set());
        winListeners.get(type).add(handler);
      },
      removeWindowListener: (type, handler) => {
        winListeners.get(type)?.delete(handler);
      },
      ...overrides,
    });
  }

  it('opens SSE when started while visible and online', () => {
    const manager = createManager();
    manager.start();
    expect(instances).toHaveLength(1);
    expect(instances[0].onopen).toBeTypeOf('function');
  });

  it('does not refetch on the initial connection', () => {
    const onReconnect = vi.fn();
    const manager = createManager({ onReconnect });
    manager.start();
    instances[0].onopen?.();
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('closes SSE when the tab is hidden and reconnects with refetch when visible', () => {
    const onReconnect = vi.fn();
    const manager = createManager({ onReconnect });
    manager.start();
    const first = instances[0];

    visibility = 'hidden';
    manager.sync();
    expect(first.close).toHaveBeenCalled();
    expect(instances).toHaveLength(0);

    visibility = 'visible';
    manager.sync();
    expect(instances).toHaveLength(1);
    instances[0].onopen?.();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('closes SSE when offline and reconnects with refetch when online', () => {
    const onReconnect = vi.fn();
    const manager = createManager({ onReconnect });
    manager.start();

    online = false;
    manager.sync();
    expect(instances).toHaveLength(0);

    online = true;
    manager.sync();
    instances[0].onopen?.();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('waits for both visible and online before reconnecting', () => {
    const manager = createManager();
    manager.start();

    visibility = 'hidden';
    online = false;
    manager.sync();
    expect(instances).toHaveLength(0);

    visibility = 'visible';
    manager.sync();
    expect(instances).toHaveLength(0);

    online = true;
    manager.sync();
    expect(instances).toHaveLength(1);
  });

  it('delays reconnect after hidden/offline so the network can settle', () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const manager = createSseManager({
      url: '/api/events',
      onMessage: vi.fn(),
      onReconnect,
      reconnectDelayMs: 500,
      getVisibility: () => visibility,
      getOnline: () => online,
      EventSourceImpl,
      setTimeoutImpl: setTimeout,
      clearTimeoutImpl: clearTimeout,
      addEventListener: (type, handler) => {
        if (!docListeners.has(type)) docListeners.set(type, new Set());
        docListeners.get(type).add(handler);
      },
      removeEventListener: (type, handler) => {
        docListeners.get(type)?.delete(handler);
      },
      addWindowListener: (type, handler) => {
        if (!winListeners.has(type)) winListeners.set(type, new Set());
        winListeners.get(type).add(handler);
      },
      removeWindowListener: (type, handler) => {
        winListeners.get(type)?.delete(handler);
      },
    });
    manager.start();

    visibility = 'hidden';
    manager.sync();
    visibility = 'visible';
    manager.sync();
    expect(instances).toHaveLength(0);

    vi.advanceTimersByTime(499);
    expect(instances).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(instances).toHaveLength(1);
    instances[0].onopen?.();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('stop closes the stream and detaches listeners without refetch', () => {
    const onReconnect = vi.fn();
    const manager = createManager({ onReconnect });
    manager.start();
    const first = instances[0];

    manager.stop();
    expect(first.close).toHaveBeenCalled();
    first.onopen?.();
    expect(onReconnect).not.toHaveBeenCalled();

    manager.sync();
    expect(instances).toHaveLength(0);
  });
});
