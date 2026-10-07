import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import * as cache from '../lib/cache.js';
import { piProviderIdForEnvVar } from '../../shared/pi-api-key-env-vars.js';
import { resolvePiCredentials } from './pi/pi-config.js';

const PI_MODELS_CACHE_TTL = 60 * 60;

function modelsCacheKey(apiKey, envVar) {
  return `pi-models:${envVar}:${apiKey.slice(0, 8)}`;
}

/**
 * @param {string} apiKey
 * @param {string} envVar
 */
export async function createPiModelRuntime(apiKey, envVar) {
  const credentials = new InMemoryCredentialStore();
  const modelRuntime = await ModelRuntime.create({ credentials });
  const providerId = piProviderIdForEnvVar(envVar);
  await modelRuntime.setRuntimeApiKey(providerId, apiKey);
  return modelRuntime;
}

/**
 * @param {string} apiKey
 * @param {string} envVar
 * @param {{ refresh?: boolean }} [options]
 */
export async function listPiModels(apiKey, envVar, { refresh = false } = {}) {
  const cacheKey = modelsCacheKey(apiKey, envVar);
  if (refresh) await cache.clear(cacheKey);
  return cache.fetch(cacheKey, PI_MODELS_CACHE_TTL, async () => {
    const runtime = await createPiModelRuntime(apiKey, envVar);
    const available = await runtime.getAvailable();
    return available.map((m) => {
      const id = m.id ?? m.modelId ?? `${m.providerId}/${m.name}`;
      const display = m.displayName ?? m.name ?? m.id ?? (typeof id === 'string' ? id : String(id));
      return {
        id: typeof id === 'string' ? id : String(id),
        display_name: typeof display === 'string' ? display : String(display),
        description: null,
      };
    });
  });
}

/**
 * @param {object} user
 * @param {object | null} [repo]
 */
export async function listPiModelsForUser(user, repo = null) {
  const { apiKey, envVar } = resolvePiCredentials(user, repo);
  if (!apiKey) return [];
  return listPiModels(apiKey, envVar);
}
