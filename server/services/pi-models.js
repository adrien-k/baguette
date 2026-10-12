import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime, resolveCliModel } from '@earendil-works/pi-coding-agent';
import * as cache from '../lib/cache.js';
import { listLunarouteGatewayModels } from '../lib/lunaroute-gateway-models.js';
import {
  isLunaroutePiApiKeyEnvVar,
  piProviderIdForEnvVar,
} from '../../shared/pi-api-key-env-vars.js';
import { attachPiModelVariants } from '../../shared/pi-model-variants.js';
import { piThinkingLevelFromModelParams } from '../../shared/pi-model-params.js';

const PI_MODELS_CACHE_TTL = 60 * 60;

/** Matches `server/pi/extensions/lunaroute-chat/oauth.ts` OAuth expiry for pasted API keys. */
const LUNAROUTE_OAUTH_EXPIRY_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function modelsCacheKey(apiKey, envVar) {
  return `pi-models:${envVar}:${apiKey.slice(0, 8)}`;
}

/**
 * LunaRoute's Pi provider only exposes OAuth auth; runtime api_key overrides are ignored.
 *
 * @param {InMemoryCredentialStore} store
 * @param {string} apiKey
 */
export async function seedLunaroutePiOAuthCredential(store, apiKey) {
  await store.modify('lunaroute', async () => ({
    type: 'oauth',
    access: apiKey,
    refresh: '',
    expires: Date.now() + LUNAROUTE_OAUTH_EXPIRY_MS,
  }));
}

/**
 * @param {string} apiKey
 * @param {string} envVar
 */
export async function createPiModelRuntime(apiKey, envVar) {
  const credentials = new InMemoryCredentialStore();
  if (isLunaroutePiApiKeyEnvVar(envVar)) {
    await seedLunaroutePiOAuthCredential(credentials, apiKey);
  }
  const modelRuntime = await ModelRuntime.create({ credentials });
  if (!isLunaroutePiApiKeyEnvVar(envVar)) {
    const providerId = piProviderIdForEnvVar(envVar);
    await modelRuntime.setRuntimeApiKey(providerId, apiKey);
  }
  return modelRuntime;
}

/**
 * Resolve a Baguette session model id after Pi extensions have registered providers.
 *
 * @param {Awaited<ReturnType<typeof createPiModelRuntime>>} modelRuntime
 * @param {string} modelId
 * @param {string} envVar
 * @param {{ apiKey?: string | null, config?: object | null, fetchImpl?: typeof fetch }} [options]
 */
export async function resolvePiSessionModel(
  modelRuntime,
  modelId,
  envVar,
  options = {},
  modelParams = null
) {
  if (!modelId) {
    return { model: undefined, thinkingLevel: undefined, error: undefined };
  }

  if (isLunaroutePiApiKeyEnvVar(envVar)) {
    await modelRuntime.refresh({ allowNetwork: true, providers: ['lunaroute'] });
    const resolved = resolveCliModel({
      cliProvider: 'lunaroute',
      cliModel: modelId,
      modelRuntime,
    });
    if (resolved.model) {
      const override = piThinkingLevelFromModelParams(modelParams);
      if (override) resolved.thinkingLevel = override;
      return resolved;
    }

    const lunarouteCount = modelRuntime
      .getModels()
      .filter((m) => m.provider === 'lunaroute').length;
    if (options.apiKey && lunarouteCount === 0) {
      try {
        const catalog = await listLunarouteGatewayModels(options.apiKey, {
          config: options.config,
          fetchImpl: options.fetchImpl,
        });
        if (!catalog.some((m) => m.id === modelId)) {
          return {
            model: undefined,
            thinkingLevel: undefined,
            error: `Model "${modelId}" is not available on your LunaRoute account.`,
          };
        }
        return {
          model: undefined,
          thinkingLevel: undefined,
          error:
            resolved.error ??
            'LunaRoute models could not be loaded into Pi. Check your API key and try again.',
        };
      } catch (err) {
        return {
          model: undefined,
          thinkingLevel: undefined,
          error: err?.message ?? 'LunaRoute authentication failed',
        };
      }
    }

    return resolved;
  }

  const resolved = resolveCliModel({ cliModel: modelId, modelRuntime });
  const override = piThinkingLevelFromModelParams(modelParams);
  if (override && resolved.model) {
    resolved.thinkingLevel = override;
  }
  return resolved;
}

function mapPiCatalogRow(m) {
  const id = m.id ?? m.modelId ?? `${m.providerId}/${m.name}`;
  const display = m.displayName ?? m.name ?? m.id ?? (typeof id === 'string' ? id : String(id));
  return attachPiModelVariants({
    id: typeof id === 'string' ? id : String(id),
    display_name: typeof display === 'string' ? display : String(display),
    description: null,
    thinkingLevelMap: m.thinkingLevelMap,
  });
}

/**
 * @param {string} apiKey
 * @param {string} envVar
 * @param {{ refresh?: boolean, config?: object | null }} [options]
 */
export async function listPiModels(apiKey, envVar, { refresh = false, config = null } = {}) {
  const cacheKey = modelsCacheKey(apiKey, envVar);
  if (refresh) await cache.clear(cacheKey);
  return cache.fetch(cacheKey, PI_MODELS_CACHE_TTL, async () => {
    if (isLunaroutePiApiKeyEnvVar(envVar)) {
      const rows = await listLunarouteGatewayModels(apiKey, { config });
      return rows.map((m) => attachPiModelVariants(m));
    }
    const runtime = await createPiModelRuntime(apiKey, envVar);
    const available = await runtime.getAvailable();
    return available.map((m) => mapPiCatalogRow(m));
  });
}
