import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent';
import { LUNAROUTE_PROVIDER } from './constants.js';
import type { ChatLunarouteModelConfig, InputLimits } from './catalog.js';
import { resolveApi, type WireApi } from './env.js';

const LUNAROUTE_ENV_AGENT_DIR = 'PI_CODING_AGENT_DIR';

function agentDirFromEnv(env: NodeJS.ProcessEnv): string {
  const value = env[LUNAROUTE_ENV_AGENT_DIR];
  return typeof value === 'string' && value ? value : join(homedir(), '.pi', 'agent');
}

export function toStoredModel(
  model: ChatLunarouteModelConfig,
  baseUrl: string,
  api: Api
): Model<Api> & { inputLimits?: InputLimits } {
  return {
    id: model.id,
    name: model.name,
    api,
    provider: LUNAROUTE_PROVIDER,
    baseUrl: model.baseUrl ?? baseUrl,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    compat: model.compat,
    inputLimits: model.inputLimits,
  };
}

function selectStoredModels(models: readonly unknown[], api: Api): ProviderModelConfig[] {
  const out: ProviderModelConfig[] = [];
  for (const model of models) {
    if (typeof model !== 'object' || model === null) continue;
    const candidate = model as { id?: unknown; type?: unknown };
    if (typeof candidate.id !== 'string') continue;
    if (candidate.type === 'classifier') continue;
    if (candidate.type !== undefined && candidate.type !== 'chat') continue;
    out.push({ ...(model as Model<Api>), api });
  }
  return out;
}

export function readPersistedModels(env: NodeJS.ProcessEnv): ProviderModelConfig[] {
  try {
    const raw = readFileSync(join(agentDirFromEnv(env), 'models-store.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { models?: unknown }>;
    const models = parsed[LUNAROUTE_PROVIDER]?.models;
    if (!Array.isArray(models)) return [];
    const api = resolveApi(env);
    return selectStoredModels(models, api);
  } catch {
    return [];
  }
}

export function resolveCredentialKey(
  credential: { type: string; access?: string; key?: string } | undefined
): string | undefined {
  if (!credential) return undefined;
  if (credential.type === 'oauth') return credential.access;
  if (credential.type === 'api_key') return credential.key;
  return undefined;
}

export type { WireApi };
