/**
 * Normalize Bash / shell tool results from Claude (plain text or JSON) and Cursor SDK payloads.
 * @returns {{ exitCode: number | null; stdout: string; stderr: string }}
 */
export function parseShellToolResult(result) {
  let exitCode = null;
  let stdout = '';
  let stderr = '';

  if (result === undefined || result === null) {
    return { exitCode, stdout, stderr };
  }

  let parsed = result;
  if (typeof result === 'string') {
    if (result === '') return { exitCode, stdout, stderr };
    try {
      parsed = JSON.parse(result);
    } catch {
      return { exitCode, stdout: result, stderr: '' };
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { exitCode, stdout: String(parsed), stderr: '' };
  }

  if (parsed.status === 'error') {
    const err = parsed.error;
    if (typeof err === 'string') stderr = err;
    else if (err?.message) stderr = String(err.message);
    else {
      try {
        stderr = JSON.stringify(err, null, 2);
      } catch {
        stderr = String(err);
      }
    }
    return { exitCode: exitCode ?? 1, stdout, stderr };
  }

  if (parsed.status === 'success' && parsed.value != null && typeof parsed.value === 'object') {
    parsed = parsed.value;
  }

  if (parsed.exitCode != null) exitCode = Number(parsed.exitCode);
  else if (parsed.exit_code != null) exitCode = Number(parsed.exit_code);

  if (Array.isArray(parsed.stdoutLines)) stdout = parsed.stdoutLines.join('\n');
  else if (parsed.stdout != null) stdout = String(parsed.stdout);
  else if (parsed.output != null) stdout = String(parsed.output);
  else if (parsed.interleavedOutput != null) stdout = String(parsed.interleavedOutput);

  if (Array.isArray(parsed.stderrLines)) stderr = parsed.stderrLines.join('\n');
  else if (parsed.stderr != null) stderr = String(parsed.stderr);

  if (!stdout && !stderr && typeof parsed.content === 'string') {
    stdout = parsed.content;
  }

  return { exitCode, stdout, stderr };
}
