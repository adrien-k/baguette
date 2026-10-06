/**
 * Extract the shell command from a typed tool_call `args` object (or generic fallback).
 * @param {Record<string, unknown> | null | undefined} args
 * @returns {string}
 */
export function resolveBashCommand(args) {
  if (!args || typeof args !== 'object') return '';
  const direct = args.command ?? args.cmd;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const input = args.input;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const nested = input.command ?? input.cmd;
    if (typeof nested === 'string' && nested.trim()) return nested;
    const desc = input.description;
    if (typeof desc === 'string' && desc.trim()) return desc;
  }
  const desc = args.description;
  if (typeof desc === 'string' && desc.trim()) return desc;
  return '';
}

/** @param {string | null | undefined} name */
export function isBashToolName(name) {
  return /^(bash|shell)$/i.test(name ?? '');
}
