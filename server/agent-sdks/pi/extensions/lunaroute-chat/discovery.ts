import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import type { Api, Model, RefreshModelsContext } from '@earendil-works/pi-ai';
import { mapCatalogEntry, type GatewayModelObject } from './catalog.js';
import { resolveApi, resolveRoutingUrl } from './env.js';
import { resolveCredentialKey, toStoredModel, type WireApi } from './persisted.js';

export type DiscoveryDeps = {
  fetch?: typeof fetch;
};

function restore(stored: RefreshModelsContext['stored'], api: WireApi): ProviderModelConfig[] {
  if (!stored?.models) return [];
  return stored.models
    .filter(
      (model) =>
        model.provider === 'lunaroute' && (model as { type?: string }).type !== 'classifier'
    )
    .map((model) => ({ ...model, api })) as ProviderModelConfig[];
}

export function createRefreshModels(
  env: NodeJS.ProcessEnv,
  deps: DiscoveryDeps = {}
): (context: RefreshModelsContext) => Promise<ProviderModelConfig[]> {
  const doFetch = deps.fetch ?? fetch;
  return async (context) => {
    const baseUrl = resolveRoutingUrl(env);
    const api = resolveApi(env);
    if (!context.allowNetwork) return restore(context.stored, api);

    const key = resolveCredentialKey(context.credential);
    if (!key) return restore(context.stored, api);

    let models: ProviderModelConfig[];
    try {
      const res = await doFetch(`${baseUrl}/models`, {
        signal: context.signal,
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        models = restore(context.stored, api);
      } else {
        const body = (await res.json()) as { data?: GatewayModelObject[] };
        const entries = body.data ?? [];
        const fetched: ProviderModelConfig[] = [];
        for (const entry of entries) {
          const result = mapCatalogEntry(entry);
          if (result.ok) fetched.push(result.model);
        }
        await context
          .publish({
            persist: {
              models: fetched.map((m) => toStoredModel(m, baseUrl, api)) as Model<Api>[],
              checkedAt: Date.now(),
            },
          })
          .catch(() => {});
        models = fetched;
      }
    } catch {
      models = restore(context.stored, api);
    }
    return models;
  };
}
