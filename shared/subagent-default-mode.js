/** @typedef {'inherit' | 'config' | 'preset'} SubagentDefaultMode */

export const SUBAGENT_DEFAULT_INHERIT = 'inherit';
export const SUBAGENT_DEFAULT_CONFIG = 'config';
export const SUBAGENT_DEFAULT_PRESET = 'preset';

export const SUBAGENT_DEFAULT_MODE_VALUES = [
  SUBAGENT_DEFAULT_INHERIT,
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
];

/** @param {string | null | undefined} raw */
export function normalizeSubagentDefaultMode(raw) {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === SUBAGENT_DEFAULT_CONFIG || v === SUBAGENT_DEFAULT_PRESET) return v;
  return SUBAGENT_DEFAULT_INHERIT;
}
