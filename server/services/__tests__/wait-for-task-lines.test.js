import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { taskAwaitTimeoutMessage } from '../../../shared/mcp-await-timeout.js';
import { waitForTaskLines } from '../mcp/lib/wait-for-task-lines.js';

function parseResult(res) {
  return JSON.parse(res.content[0].text);
}

describe('waitForTaskLines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns output when the task exits', async () => {
    const task = {
      id: 5,
      label: 'run-tests',
      onLog(fn) {
        fn(5, 'stdout', 'ok\n');
        return () => {};
      },
      onExit(fn) {
        fn(5, 0);
        return () => {};
      },
    };

    const result = parseResult(await waitForTaskLines(task, { timeoutMs: null }));
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdoutLines).toEqual(['ok']);
  });

  it('returns fail with steering message when timeoutMs is exceeded', async () => {
    const task = {
      id: 9,
      label: 'slow-build',
      onLog() {
        return () => {};
      },
      onExit() {
        return () => {};
      },
    };

    const promise = waitForTaskLines(task, { timeoutMs: 250 });
    await vi.advanceTimersByTimeAsync(300);
    const result = parseResult(await promise);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(taskAwaitTimeoutMessage(task));
  });
});
