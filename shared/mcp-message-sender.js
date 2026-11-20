/**
 * Who injected an MCP user message (`CreateSessionMessage`, `StartSubagent`, …).
 *
 * @typedef {SessionMcpMessageSender | ExternalMcpMessageSender} McpMessageSender
 */

/**
 * @typedef {object} SessionMcpMessageSender
 * @property {'session'} kind
 * @property {number} session_id
 * @property {string} session_label
 * @property {boolean} [is_global]
 * @property {number | null} [repo_id]
 * @property {number} [agent_id]
 * @property {number} [agent_ref]
 * @property {string} [agent_name]
 */

/**
 * Inbound HTTP MCP with no active Baguette session agent.
 *
 * @typedef {object} ExternalMcpMessageSender
 * @property {'external'} kind
 * @property {string} label
 * @property {'integrations'} [settings_tab]
 */

/** @param {unknown} value */
export function isMcpMessageSender(value) {
  if (!value || typeof value !== 'object') return false;
  const kind = /** @type {{ kind?: string }} */ (value).kind;
  if (kind === 'external') {
    return typeof (/** @type {{ label?: string }} */ (value).label) === 'string';
  }
  if (kind === 'session') {
    const s = /** @type {{ session_id?: unknown; session_label?: unknown }} */ (value);
    return typeof s.session_id === 'number' && typeof s.session_label === 'string';
  }
  return false;
}
