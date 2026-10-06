import { ok } from './result.js';
import { streamToLines } from './stream-to-lines.js';

/** Wait for a baguette Task to exit and return stdout/stderr as line arrays. */
export function waitForTaskLines(task) {
  let stdout = '';
  let stderr = '';
  return new Promise((resolve) => {
    const unsubLog = task.onLog((_id, stream, data) => {
      if (stream === 'stdout') stdout += data;
      else stderr += data;
    });
    task.onExit((_id, exitCode) => {
      unsubLog();
      resolve(
        ok({
          exitCode,
          stdoutLines: streamToLines(stdout),
          stderrLines: streamToLines(stderr),
        })
      );
    });
  });
}
