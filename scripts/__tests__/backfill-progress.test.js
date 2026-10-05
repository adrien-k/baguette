import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSessionProgress } from '../backfill-progress.js';

function withStderrTty(value, fn) {
  const prev = process.stderr.isTTY;
  Object.defineProperty(process.stderr, 'isTTY', { value, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process.stderr, 'isTTY', { value: prev, configurable: true });
  }
}

describe('createSessionProgress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs percent lines when stderr is not a TTY', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    withStderrTty(false, () => {
      const progress = createSessionProgress('Test backfill', 4);
      progress.sessionDone();
      progress.sessionDone();
      progress.sessionDone();
      progress.sessionDone();
      progress.done();
    });

    expect(log).toHaveBeenCalledWith('Test backfill: 25% (1/4 sessions)');
    expect(log).toHaveBeenCalledWith('Test backfill: 50% (2/4 sessions)');
    expect(log).toHaveBeenCalledWith('Test backfill: 75% (3/4 sessions)');
    expect(log).toHaveBeenCalledWith('Test backfill: 100% (4/4 sessions)');
  });

  it('reports 100% for zero sessions', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    withStderrTty(false, () => {
      const progress = createSessionProgress('Empty', 0);
      progress.done();
    });

    expect(log).toHaveBeenCalledWith('Empty: 100% (0/0 sessions)');
  });
});
