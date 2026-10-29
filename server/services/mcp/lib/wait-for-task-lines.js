import {
  MCP_AWAIT_TIMEOUT_MS,
  taskAwaitTimeoutMessage,
} from '../../../../shared/mcp-await-timeout.js';
import { ok, fail } from './result.js';
import { streamToLines } from './stream-to-lines.js';

/** Wait for a baguette Task to exit and return stdout/stderr as line arrays. */
export function waitForTaskLines(task, { timeoutMs = MCP_AWAIT_TIMEOUT_MS } = {}) {
  let stdout = '';
  let stderr = '';
  const hasTimeout = timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0;

  return new Promise((resolve) => {
    let settled = false;
    let unsubLog = () => {};
    let unsubExit = () => {};
    let timeoutId;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      unsubLog();
      unsubExit();
      resolve(result);
    };

    if (hasTimeout) {
      timeoutId = setTimeout(() => {
        settle(fail(taskAwaitTimeoutMessage(task)));
      }, timeoutMs);
    }

    unsubLog = task.onLog((_id, stream, data) => {
      if (stream === 'stdout') stdout += data;
      else stderr += data;
    });
    unsubExit = task.onExit((_id, exitCode) => {
      settle(
        ok({
          exitCode,
          stdoutLines: streamToLines(stdout),
          stderrLines: streamToLines(stderr),
        })
      );
    });
  });
}
