/**
 * Map typed message_json payloads to session_messages columns (scoped by `agent_id`).
 */

/**
 * @param {number} sessionId
 * @param {number|null} turnId
 * @param {object} payload
 * @param {{ agent_id?: number, agent_sdk?: string | null, model?: string | null, model_params?: unknown }} [identity]
 */
export function dbRowFromPayload(sessionId, turnId, payload, identity = {}) {
  const row = {
    session_id: sessionId,
    turn_id: turnId ?? null,
    message_json: JSON.stringify(payload),
    ...(identity.agent_id != null ? { agent_id: identity.agent_id } : {}),
    ...(identity.agent_sdk ? { agent_sdk: identity.agent_sdk } : {}),
    ...(identity.model ? { model: identity.model } : {}),
    ...(identity.model_params != null ? { model_params: identity.model_params } : {}),
  };

  switch (payload.type) {
    case 'tool_call':
      return {
        ...row,
        type: 'tool_call',
        tool_call_id: payload.id,
        tool_status: payload.status,
        tool_started_at: payload.started_at,
        tool_ended_at: payload.ended_at,
      };
    case 'turn_result':
      return {
        ...row,
        type: 'turn_result',
        total_cost_usd: payload.total_cost_usd ?? null,
      };
    case 'system':
      return {
        ...row,
        type: 'system',
        subtype: payload.subtype ?? null,
      };
    case 'user':
      return {
        ...row,
        type: 'user',
        subtype: payload.subtype ?? null,
      };
    case 'assistant':
      return { ...row, type: 'assistant' };
    case 'plan':
      return { ...row, type: 'plan' };
    default:
      return { ...row, type: payload.type ?? 'system' };
  }
}

/**
 * Patch fields when updating a tool_call payload.
 * @param {object} payload
 */
export function dbPatchFromPayload(payload) {
  const patch = { message_json: JSON.stringify(payload) };
  if (payload.type === 'tool_call') {
    patch.tool_status = payload.status;
    patch.tool_ended_at = payload.ended_at;
  }
  if (payload.type === 'system') {
    patch.subtype = payload.subtype ?? null;
  }
  return patch;
}
