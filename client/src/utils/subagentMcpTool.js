/**
 * Resolve which subagent a StartSubagent / AwaitSubagent MCP tool call refers to.
 * @param {'StartSubagent' | 'AwaitSubagent'} toolName
 * @param {Record<string, unknown> | undefined} args
 * @param {Record<string, unknown> | null | undefined} parsedResult
 */
export function resolveSubagentTargetFromMcpTool(toolName, args, parsedResult) {
  const data =
    parsedResult && typeof parsedResult === 'object' && !Array.isArray(parsedResult)
      ? parsedResult
      : null;
  const nested =
    data?.subagent && typeof data.subagent === 'object' && !Array.isArray(data.subagent)
      ? data.subagent
      : null;

  let agentId = data?.agent_id ?? nested?.agent_id ?? null;
  let agentRef = data?.ref ?? nested?.ref ?? null;
  let name =
    (typeof data?.name === 'string' ? data.name : null) ??
    (typeof nested?.name === 'string' ? nested.name : null) ??
    null;
  let status =
    (typeof data?.status === 'string' ? data.status : null) ??
    (typeof nested?.status === 'string' ? nested.status : null) ??
    null;

  if (toolName === 'AwaitSubagent') {
    if (args?.agent_id != null) agentId = args.agent_id;
    if (args?.agent_ref != null) agentRef = args.agent_ref;
  }
  if (toolName === 'StartSubagent' && typeof args?.name === 'string' && args.name.trim()) {
    name = args.name.trim();
  }

  return {
    agentId: agentId != null ? Number(agentId) : null,
    agentRef: agentRef != null ? Number(agentRef) : null,
    name,
    status,
  };
}

/**
 * Match session agents by stable id/ref only (never by display name).
 * @param {Array<{ id?: number; ref?: number; name?: string; agent_type?: string }> | undefined} agents
 * @param {{ agentId?: number | null; agentRef?: number | null; name?: string | null }} target
 */
export function findSessionAgentForSubagentTool(agents, target) {
  if (!Array.isArray(agents) || !agents.length) return null;
  const id = target.agentId;
  if (id != null && Number.isFinite(id)) {
    const byId = agents.find((a) => a.id === id);
    if (byId) return byId;
  }
  const ref = target.agentRef;
  if (ref != null && Number.isFinite(ref)) {
    const byRef = agents.find((a) => a.ref === ref);
    if (byRef) return byRef;
  }
  return null;
}

/**
 * @param {Array<{ id?: number; ref?: number; name?: string; agent_type?: string }> | undefined} agents
 * @param {'StartSubagent' | 'AwaitSubagent'} toolName
 * @param {Record<string, unknown> | undefined} args
 * @param {Record<string, unknown> | null | undefined} parsedResult
 */
export function resolveSubagentForMcpToolCall(agents, toolName, args, parsedResult) {
  const target = resolveSubagentTargetFromMcpTool(toolName, args, parsedResult);
  const agent = findSessionAgentForSubagentTool(agents, target);
  return { ...target, agent };
}

/** True when navigation can target a specific subagent (id/ref), not a name guess. */
export function subagentToolHasStableIdentity(target) {
  if (!target) return false;
  if (target.agentId != null && Number.isFinite(target.agentId)) return true;
  if (target.agentRef != null && Number.isFinite(target.agentRef)) return true;
  return false;
}

function subagentNameMatches(agent, name) {
  if (!agent || typeof agent.name !== 'string') return false;
  return agent.name.trim() === name;
}

function pickNewestSubagentByRef(candidates) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates.reduce((best, agent) => {
    const bestRef = best?.ref ?? -1;
    const nextRef = agent?.ref ?? -1;
    if (nextRef > bestRef) return agent;
    if (nextRef < bestRef) return best;
    const bestId = best?.id ?? -1;
    const nextId = agent?.id ?? -1;
    return nextId > bestId ? agent : best;
  });
}

/**
 * While StartSubagent is still running (no MCP result yet), the subagent row often
 * already exists — match by display name and parent builder that invoked the tool.
 * @param {Array<{ id?: number; ref?: number; name?: string; agent_type?: string; parent_agent_id?: number | null }> | undefined} agents
 * @param {string} name
 * @param {number | null | undefined} parentAgentId
 */
export function findRunningStartSubagentInSession(agents, name, parentAgentId) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || !Array.isArray(agents) || !agents.length) return null;
  const parentId =
    parentAgentId != null && Number.isFinite(Number(parentAgentId)) ? Number(parentAgentId) : null;
  const candidates = agents.filter((agent) => {
    if (agent.agent_type !== 'subagent') return false;
    if (!subagentNameMatches(agent, trimmed)) return false;
    if (parentId == null) return true;
    return agent.parent_agent_id === parentId;
  });
  return pickNewestSubagentByRef(candidates);
}

/**
 * Session agent to open in chat for this MCP subagent tool call, if known.
 * @param {Array<{ id?: number; ref?: number; name?: string; agent_type?: string; status?: string; parent_agent_id?: number | null }> | undefined} agents
 * @param {'StartSubagent' | 'AwaitSubagent'} toolName
 * @param {Record<string, unknown> | undefined} args
 * @param {Record<string, unknown> | null | undefined} parsedResult
 * @param {{ parentAgentId?: number | null; isRunning?: boolean }} [options]
 */
export function resolveOpenSubagentFromMcpTool(agents, toolName, args, parsedResult, options = {}) {
  const { parentAgentId, isRunning = false } = options;
  const resolved = resolveSubagentForMcpToolCall(agents, toolName, args, parsedResult);
  if (resolved.agent?.id) return resolved.agent;

  if (resolved.agentId != null && Number.isFinite(resolved.agentId) && resolved.agentId > 0) {
    const fromSession = findSessionAgentForSubagentTool(agents, { agentId: resolved.agentId });
    if (fromSession) return fromSession;
    return {
      id: resolved.agentId,
      ref: resolved.agentRef ?? undefined,
      name: resolved.name ?? undefined,
      agent_type: 'subagent',
      status: resolved.status ?? undefined,
    };
  }

  if (resolved.agentRef != null && Number.isFinite(resolved.agentRef)) {
    const fromRef = findSessionAgentForSubagentTool(agents, { agentRef: resolved.agentRef });
    if (fromRef) return fromRef;
  }

  if (toolName === 'StartSubagent' && isRunning && typeof args?.name === 'string') {
    return findRunningStartSubagentInSession(agents, args.name, parentAgentId);
  }

  return null;
}

/** @param {unknown[]} blocks */
function textFromAssistantBlocks(blocks) {
  if (!Array.isArray(blocks)) return null;
  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text.trim());
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}

/** Legacy Claude-style `{ content: string | text-block[] }`. */
function textFromLegacyMessageContent(content) {
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (!Array.isArray(content)) return null;
  return textFromAssistantBlocks(content);
}

/** Typed `{ type: 'assistant', blocks: [...] }` stored in `message_json`. */
function previewFromAssistantMessageJson(messageJson) {
  if (typeof messageJson !== 'string' || !messageJson.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(messageJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.type === 'assistant' && Array.isArray(parsed.blocks)) {
    return textFromAssistantBlocks(parsed.blocks);
  }
  const envelope = parsed.message;
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
    return textFromLegacyMessageContent(envelope.content);
  }
  return null;
}

/**
 * Plain-text preview of `last_assistant_message` from subagent MCP results.
 * @param {Record<string, unknown> | null | undefined} parsedResult
 */
export function subagentLastAssistantPreview(parsedResult) {
  const row = parsedResult?.last_assistant_message;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;

  const fromJson = previewFromAssistantMessageJson(row.message_json);
  if (fromJson) return fromJson;

  const message = row.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    if (Array.isArray(message.blocks)) {
      const fromBlocks = textFromAssistantBlocks(message.blocks);
      if (fromBlocks) return fromBlocks;
    }
    const fromContent = textFromLegacyMessageContent(message.content);
    if (fromContent) return fromContent;
  }
  return null;
}
