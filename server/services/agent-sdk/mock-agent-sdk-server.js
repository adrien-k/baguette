import { MOCK_AGENT_SDK, listMockModels } from '../../../shared/mock-agent-sdk.js';
import { isMockAgentServerEnabled } from './mock-agent-enabled.js';

export const MOCK_AGENT_SDK_LABEL = 'Mock';
export const MOCK_AGENT_SERVICE_PATH = 'mock-agent';

export function isMockAgentSdkEnabledOnServer() {
  return isMockAgentServerEnabled();
}

export function isMockAgentSdkEnabledForUser(_ctx = {}) {
  return isMockAgentServerEnabled();
}

export async function listMockAgentModels() {
  if (!isMockAgentServerEnabled()) return [];
  return listMockModels();
}

export { MOCK_AGENT_SDK };
