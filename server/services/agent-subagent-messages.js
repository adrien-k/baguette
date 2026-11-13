import { BadRequest } from 'feathers/errors';
import { getAgentById } from './agents-db.js';

export function isMcpUserMessagePayload(data) {
  if (data?.subtype === 'mcp') return true;
  if (!data?.message_json) return false;
  try {
    const parsed =
      typeof data.message_json === 'string' ? JSON.parse(data.message_json) : data.message_json;
    return parsed?.source === 'mcp' || parsed?.subtype === 'mcp';
  } catch {
    return false;
  }
}

/** Block Baguette UI user messages to subagent builders (MCP payloads still allowed). */
export async function rejectNonMcpMessageToSubagentBuilder(context) {
  if (!context.params?.provider || context.data?.type !== 'user') return context;
  if (isMcpUserMessagePayload(context.data)) return context;
  const agentId = context.data.agent_id;
  if (!agentId) return context;
  const agent = await getAgentById(context.app.get('db'), agentId);
  if (agent?.agent_type === 'subagent') {
    throw new BadRequest(
      'This agent only accepts new messages via MCP (StartSubagent or CreateSessionMessage).'
    );
  }
  return context;
}
