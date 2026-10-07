import { resolveAgentSdkKeys } from '../../../shared/agent-sdk-credentials.js';
import { listClaudeModels, resolveClaudeGatewayConfig } from '../claude-gateway-models.js';

export const CLAUDE_AGENT_SDK_KEY = 'claude';
export const CLAUDE_AGENT_SDK_LABEL = 'Claude';
export const CLAUDE_AGENT_SERVICE_PATH = 'claude-agent';

export function isClaudeAgentSdkEnabled({ user, repo = null }) {
  const keys = resolveAgentSdkKeys(user, repo);
  return Boolean(keys.anthropic_api_key || keys.anthropic_auth_token);
}

export async function listClaudeAgentModels({ user, repo = null }, { refresh = false } = {}) {
  if (!isClaudeAgentSdkEnabled({ user, repo })) return [];
  return listClaudeModels(resolveClaudeGatewayConfig(user, repo), { refresh });
}
