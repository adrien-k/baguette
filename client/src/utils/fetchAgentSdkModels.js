import { agentSdksService } from '../feathers.js';

/**
 * Enabled agent SDKs for a repository (repo + account credentials).
 * Omit `repoId` to use account credentials only.
 * @param {number|string} [repoId]
 * @returns {Promise<Array<{ key: string, label: string }>>}
 */
export async function fetchAvailableAgentSdks(repoId) {
  const query = {};
  if (repoId != null && repoId !== '') query.repo_id = repoId;
  const result = await agentSdksService.find({ query });
  return result?.sdks ?? [];
}

/**
 * List models for one agent SDK and repository (repo + account credentials).
 * @param {string} [sdk]
 * @param {number|string} repoId
 * @param {{ refresh?: boolean }} [options]
 */
export async function fetchAgentSdkModels(sdk, repoId, { refresh = false } = {}) {
  if (repoId == null || repoId === '') {
    throw new Error('repo_id is required to load agent models');
  }
  if (!sdk) {
    throw new Error('sdk is required to load agent models');
  }
  const query = {
    repo_id: repoId,
    sdk,
  };
  if (refresh) query.refresh = 'true';
  const result = await agentSdksService.models(null, { query });
  return result?.models ?? [];
}
