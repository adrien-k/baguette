import {
  GLOBAL_SESSION_EXCLUDED_MCP_TOOLS,
  SUBAGENT_EXCLUDED_MCP_TOOLS,
  isGlobalSession,
} from '../../../shared/session-scope.js';
import { buildBaseAgentTools } from './registries/base_agent.js';
import { buildBuilderAgentTools } from './registries/builder_agent.js';
import { wrapBaguetteToolList } from './lib/wrap-baguette-tool-handler.js';

export { buildReviewerAgentTools } from './registries/reviewer_agent.js';

/**
 * Creates tool definitions shared between SDK plugins (`adaptTools`).
 * Returns an array of { name, description, schema (Zod shape), handler }.
 *
 * Slack tools are included only when `slackApps` has at least one bot token.
 * Callers (agent services) load configured Slack apps and pass them in.
 */
export async function buildBaguetteToolList(session, app, { slackApps = [], agent = null } = {}) {
  let baseTools = [];
  try {
    const owner = await app.service('users').get(session.user_id, {});
    baseTools = buildBaseAgentTools(owner, app, { callerSession: session, callerAgent: agent });
  } catch {
    baseTools = [];
  }

  const tools = [...baseTools, ...buildBuilderAgentTools(session, app, { slackApps, agent })];

  let wrapped = wrapBaguetteToolList(session, app, tools);
  if (isGlobalSession(session)) {
    const excluded = new Set(GLOBAL_SESSION_EXCLUDED_MCP_TOOLS);
    wrapped = wrapped.filter((t) => !excluded.has(t.name));
  }
  if (agent?.agent_type === 'subagent') {
    const excluded = new Set(SUBAGENT_EXCLUDED_MCP_TOOLS);
    wrapped = wrapped.filter((t) => !excluded.has(t.name));
  }
  return wrapped;
}
