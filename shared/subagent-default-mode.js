/**
 * Account policy for models an agent may use on StartSubagent, CreateSession, and loops.
 * Stored on users.subagent_default_mode.
 * @typedef {'inherit' | 'config' | 'preset' | 'any'} SubagentDefaultMode
 */

export const SUBAGENT_DEFAULT_INHERIT = 'inherit';
export const SUBAGENT_DEFAULT_CONFIG = 'config';
export const SUBAGENT_DEFAULT_PRESET = 'preset';
/** Agent may pass a preset or any model from ListModels. */
export const SUBAGENT_DEFAULT_ANY = 'any';

export const SUBAGENT_DEFAULT_MODE_VALUES = [
  SUBAGENT_DEFAULT_INHERIT,
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
  SUBAGENT_DEFAULT_ANY,
];

/** @param {string | null | undefined} raw */
export function normalizeSubagentDefaultMode(raw) {
  const v = (raw ?? '').trim().toLowerCase();
  if (SUBAGENT_DEFAULT_MODE_VALUES.includes(v)) return v;
  return SUBAGENT_DEFAULT_INHERIT;
}
