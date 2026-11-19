/** Display label for inbound HTTP MCP (`/api/mcp`) when there is no caller session. */
const EXTERNAL_MCP_ACCESS_LABEL = 'Baguette MCP';

/**
 * @typedef {import('../../../../shared/mcp-message-sender.js').McpMessageSender} McpMessageSender
 */

/**
 * Build sender metadata for an MCP-injected user message from tool context.
 *
 * @param {import('@feathersjs/knex').Knex} db
 * @param {{ callerSession?: object | null, callerAgent?: object | null }} ctx
 * @returns {Promise<McpMessageSender | null>}
 */
export async function resolveMcpMessageSender(
  db,
  { callerSession = null, callerAgent = null } = {}
) {
  if (callerSession?.id == null) {
    return {
      kind: 'external',
      label: EXTERNAL_MCP_ACCESS_LABEL,
      settings_tab: 'integrations',
    };
  }

  let sessionLabel = typeof callerSession.label === 'string' ? callerSession.label.trim() : '';
  let isGlobal = !!callerSession.is_global;
  let repoId = callerSession.repo_id ?? null;

  if (!sessionLabel || callerSession.is_global === undefined) {
    const row = await db('sessions')
      .where({ id: callerSession.id })
      .select('label', 'is_global', 'repo_id')
      .first();
    if (!row) return null;
    sessionLabel = (row.label ?? '').trim() || `Session ${callerSession.id}`;
    isGlobal = !!row.is_global;
    repoId = row.repo_id ?? null;
  }

  /** @type {McpMessageSender} */
  const sender = {
    kind: 'session',
    session_id: callerSession.id,
    session_label: sessionLabel || `Session ${callerSession.id}`,
    is_global: isGlobal,
    repo_id: repoId,
  };

  const agentId = callerAgent?.id ?? null;
  if (agentId == null) return sender;

  let agentName = typeof callerAgent.name === 'string' ? callerAgent.name.trim() : '';
  let agentRef = callerAgent.ref ?? null;

  if (!agentName || agentRef == null) {
    const agentRow = await db('agents')
      .where({ id: agentId, session_id: callerSession.id })
      .select('id', 'ref', 'name')
      .first();
    if (!agentRow) return sender;
    agentName = (agentRow.name ?? '').trim() || `Agent #${agentRow.ref}`;
    agentRef = agentRow.ref;
  }

  sender.agent_id = agentId;
  sender.agent_ref = agentRef;
  sender.agent_name = agentName || (agentRef != null ? `Agent #${agentRef}` : 'Agent');

  return sender;
}

/**
 * Sender for StartSubagent initial messages (parent agent in the same session).
 *
 * @param {import('@feathersjs/knex').Knex} db
 * @param {number} sessionId
 * @param {number | null} parentAgentId
 * @returns {Promise<McpMessageSender | null>}
 */
export async function resolveMcpMessageSenderForParentAgent(db, sessionId, parentAgentId) {
  if (parentAgentId == null) return null;
  const session = await db('sessions').where({ id: sessionId }).first();
  if (!session) return null;
  const parent = await db('agents').where({ id: parentAgentId, session_id: sessionId }).first();
  if (!parent) return null;
  return resolveMcpMessageSender(db, {
    callerSession: session,
    callerAgent: parent,
  });
}
