import { canonicalToolName } from './session-message-mappers.js';

/**
 * Human-readable tool label for logs and debug views (chat uses richer blocks).
 * @param {string | null | undefined} name
 * @param {Record<string, unknown> | null | undefined} [args]
 */
export function logToolDisplayName(name, args = {}) {
  const input = args && typeof args === 'object' ? args : {};
  if (name === 'mcp') {
    const toolName = input.toolName ?? input.tool ?? 'tool';
    const namespace = input.namespace ?? input.server;
    if (namespace) return `MCP · ${namespace} · ${toolName}`;
    return `MCP · ${toolName}`;
  }
  if (name?.startsWith('mcp__baguette__')) {
    return `MCP · Baguette · ${name.slice('mcp__baguette__'.length)}`;
  }
  if (name?.startsWith('mcp__')) {
    const parts = name.split('__').filter(Boolean);
    if (parts.length >= 3) {
      return `MCP · ${parts[1]} · ${parts.slice(2).join('__')}`;
    }
    return `MCP · ${parts[parts.length - 1] ?? name}`;
  }
  const canonical = canonicalToolName(name ?? '');
  return canonical || name || 'tool';
}

/**
 * One-line preview for a typed tool_call row in the logs list.
 * @param {{ name?: string; kind?: string; args?: Record<string, unknown>; status?: string }} call
 */
export function logToolCallSummary(call) {
  const name = call.name ?? '';
  const args = call.args ?? {};
  const label = logToolDisplayName(name, args);

  if (call.kind === 'bash' || name === 'Bash' || name === 'shell') {
    const cmd = args.command ?? args.cmd;
    if (typeof cmd === 'string' && cmd.trim()) {
      return `${label} — ${cmd.trim().replace(/\s+/g, ' ').slice(0, 100)}`;
    }
  }
  if (call.kind === 'mcp' || name === 'mcp' || name?.startsWith('mcp__')) {
    const desc = args.description ?? args.query ?? args.path ?? args.filePath;
    if (typeof desc === 'string' && desc.trim()) {
      return `${label} — ${desc.trim().slice(0, 80)}`;
    }
  }
  if (typeof args.path === 'string' && args.path) {
    return `${label} — ${args.path.slice(0, 80)}`;
  }
  if (typeof args.file_path === 'string' && args.file_path) {
    return `${label} — ${args.file_path.slice(0, 80)}`;
  }
  if (call.status === 'running') return `${label} (running)`;
  if (call.status === 'error') return `${label} (error)`;
  return label;
}
