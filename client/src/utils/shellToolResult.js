/**
 * Join MCP `content` blocks (Cursor nested `{ text: { text } }` or `{ type: 'text', text }`).
 * @param {unknown} obj
 * @returns {string | null}
 */
function extractMcpTextContent(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const content = obj.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const textField = block.text;
    if (typeof textField === 'string') parts.push(textField);
    else if (textField && typeof textField === 'object' && typeof textField.text === 'string') {
      parts.push(textField.text);
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}

/**
 * Peel MCP wrappers and JSON-string layers until we reach a shell payload or plain text.
 * @param {unknown} result
 * @param {number} [depth]
 * @returns {unknown}
 */
export function unwrapShellToolPayload(result, depth = 0) {
  if (depth > 6 || result === undefined || result === null) return result;

  let parsed = result;
  if (typeof result === 'string') {
    if (!result.trim()) return result;
    try {
      parsed = JSON.parse(result);
    } catch {
      return result;
    }
  }

  if (typeof parsed !== 'object' || parsed === null) return parsed;

  const hasShellFields =
    parsed.exitCode != null ||
    parsed.exit_code != null ||
    Array.isArray(parsed.stdoutLines) ||
    parsed.stdout != null ||
    parsed.stderr != null ||
    Array.isArray(parsed.stderrLines);
  if (hasShellFields) return parsed;

  const mcpText = extractMcpTextContent(parsed);
  if (mcpText) {
    const trimmed = mcpText.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return unwrapShellToolPayload(JSON.parse(trimmed), depth + 1);
      } catch {
        return mcpText;
      }
    }
    return mcpText;
  }

  if (parsed.data != null && parsed.data !== parsed) {
    const inner = unwrapShellToolPayload(parsed.data, depth + 1);
    if (inner !== parsed.data) return inner;
  }

  if (typeof parsed.content === 'string' && parsed.content.trim().startsWith('{')) {
    try {
      return unwrapShellToolPayload(JSON.parse(parsed.content), depth + 1);
    } catch {
      /* keep parsed */
    }
  }

  return parsed;
}

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

  const unwrapped = unwrapShellToolPayload(result);

  let parsed = unwrapped;
  if (typeof unwrapped === 'string') {
    if (unwrapped === '') return { exitCode, stdout, stderr };
    try {
      parsed = JSON.parse(unwrapped);
    } catch {
      return { exitCode, stdout: unwrapped, stderr: '' };
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
