import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchSseConnection } from '../sseConnectionWatcher.js';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/** Minimal stand-in for the browser EventSource, driven manually by the tests. */
function fakeSource(readyState = CONNECTING) {
  return {
    readyState,
    onopen: null,
    onerror: null,
    open() {
      this.readyState = OPEN;
      this.onopen?.();
    },
    error(state = CONNECTING) {
      this.readyState = state;
      this.onerror?.();
    },
  };
}

describe('watchSseConnection', () => {
  let onLost;
  let onRestored;

  beforeEach(() => {
    vi.useFakeTimers();
    onLost = vi.fn();
    onRestored = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const watch = (source) => watchSseConnection(source, { onLost, onRestored, graceMs: 1000 });

  it('stays quiet when the browser reconnects within the grace period', () => {
    const source = fakeSource();
    watch(source);

    source.error();
    vi.advanceTimersByTime(500);
    source.open();
    vi.advanceTimersByTime(5000);

    expect(onLost).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('reports a loss once the stream stays down past the grace period', () => {
    const source = fakeSource();
    watch(source);

    source.error();
    vi.advanceTimersByTime(1000);

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('reports immediately when the browser gives up retrying', () => {
    const source = fakeSource();
    watch(source);

    source.error(CLOSED);

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('reports the loss only once while retries keep failing', () => {
    const source = fakeSource();
    watch(source);

    source.error();
    vi.advanceTimersByTime(1000);
    source.error();
    vi.advanceTimersByTime(5000);
    source.error();
    vi.advanceTimersByTime(5000);

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('reports a restore only after a reported loss', () => {
    const source = fakeSource();
    watch(source);

    source.open();
    expect(onRestored).not.toHaveBeenCalled();

    source.error();
    vi.advanceTimersByTime(1000);
    source.open();

    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('can lose and restore the connection repeatedly', () => {
    const source = fakeSource();
    watch(source);

    for (let i = 0; i < 2; i++) {
      source.error();
      vi.advanceTimersByTime(1000);
      source.open();
    }

    expect(onLost).toHaveBeenCalledTimes(2);
    expect(onRestored).toHaveBeenCalledTimes(2);
  });

  it('stops reporting after unsubscribe', () => {
    const source = fakeSource();
    const unsubscribe = watch(source);

    source.error();
    unsubscribe();
    vi.advanceTimersByTime(5000);

    expect(onLost).not.toHaveBeenCalled();
    expect(source.onerror).toBeNull();
  });
});
