import { BadRequest } from '@feathersjs/errors';
import { runClaudeConnectivityTest } from './claude-connectivity.js';
import { isMockAgentSdkEnabled } from '../../shared/mock-agent-sdk.js';
import { runCursorConnectivityTest } from './cursor-connectivity.js';
import { runPiConnectivityTest } from './pi-connectivity.js';

/**
 * Connectivity test for a decrypted agent_configs row (draft or saved).
 * @param {object} config — includes sdk, api_key, api_url, api_key_env_var
 */
export async function testFromAgentConfig(config) {
  const sdk = config?.sdk;
  if (sdk === 'claude') return runClaudeConnectivityTest(config);
  if (sdk === 'cursor') return runCursorConnectivityTest(config);
  if (sdk === 'pi') return runPiConnectivityTest(config);
  if (sdk === 'mock') {
    if (!isMockAgentSdkEnabled()) {
      throw new BadRequest('Mock agent is not enabled on this server');
    }
    return { ok: true, checks: [{ id: 'mock', label: 'Mock agent', ok: true }] };
  }
  throw new BadRequest(`Unsupported sdk "${sdk}"`);
}
