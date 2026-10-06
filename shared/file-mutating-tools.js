/** Tool names that change files on disk (Cursor / Claude SDK). */
const FILE_MUTATING_TOOL_NAMES = new Set(['Write', 'Edit', 'Create', 'StrReplace']);

/**
 * Whether a session_messages row is a completed file-mutating tool call.
 * @param {{ type?: string; kind?: string; name?: string; tool_status?: string; status?: string }} msg
 */
export function isFileMutatingToolCall(msg) {
  if (!msg || msg.type !== 'tool_call') return false;
  if (msg.kind === 'edit' || msg.kind === 'write') return true;
  if (msg.name && FILE_MUTATING_TOOL_NAMES.has(msg.name)) return true;
  return false;
}

export function isTerminalToolCall(msg) {
  const status = msg.tool_status ?? msg.status;
  return status != null && status !== 'running';
}
