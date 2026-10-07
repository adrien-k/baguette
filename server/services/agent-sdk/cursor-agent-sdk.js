import { resolveAgentSdkKeys } from '../../../shared/agent-sdk-credentials.js';
import { listCursorModels, refreshCursorModels } from '../cursor-models.js';

export const CURSOR_AGENT_SDK_KEY = 'cursor';
export const CURSOR_AGENT_SDK_LABEL = 'Cursor';
export const CURSOR_AGENT_SERVICE_PATH = 'cursor-agent';

export function isCursorAgentSdkEnabled({ user, repo = null }) {
  const keys = resolveAgentSdkKeys(user, repo);
  return Boolean(keys.cursor_api_key);
}

export async function listCursorAgentModels({ user, repo = null }, { refresh = false } = {}) {
  const keys = resolveAgentSdkKeys(user, repo);
  if (!keys.cursor_api_key) return [];
  if (refresh) return refreshCursorModels(keys.cursor_api_key);
  return listCursorModels(keys.cursor_api_key);
}
