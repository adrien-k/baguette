import { EXTERNAL_MCP_EXCLUDED_TOOLS } from '../../shared/session-scope.js';
import { buildBaseAgentTools } from './mcp/registries/base_agent.js';

/** @deprecated Use buildBaseAgentTools */
export function buildBaguetteAccountToolList(user, app, options) {
  return buildBaseAgentTools(user, app, options);
}

/** Account-level tools exposed on inbound HTTP MCP (stateless; no caller session). */
export function buildExternalMcpToolList(user, app) {
  const excluded = new Set(EXTERNAL_MCP_EXCLUDED_TOOLS);
  return buildBaseAgentTools(user, app).filter((t) => !excluded.has(t.name));
}
