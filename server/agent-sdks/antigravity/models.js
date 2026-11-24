import crypto from 'node:crypto';
import os from 'node:os';
import * as cache from '../../lib/cache.js';
import { AcpProcessClient } from './acp-client.ts';
import { buildAntigravityEnv, parseExtraEnvJson, resolveAgyBinary } from './env.js';

const MODELS_CACHE_TTL = 60 * 60;

const THOUGHT_LEVEL_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const THOUGHT_LEVEL_SET = new Set(THOUGHT_LEVEL_ORDER);

function modelsCacheKey(config) {
  const extraEnv = parseExtraEnvJson(config?.extra_env_json);
  const binary = resolveAgyBinary(extraEnv);
  const secret = typeof config?.api_key === 'string' ? config.api_key.trim() : '';
  const tagSource = `${binary}|${secret}|${JSON.stringify(extraEnv)}`;
  const hash = crypto.createHash('sha256').update(tagSource).digest('hex').slice(0, 12);
  return `antigravity-models:${hash}`;
}

function flattenConfigSelectOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) return [];
  const out = [];
  for (const item of rawOptions) {
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item.options)) {
      for (const nested of item.options) {
        if (nested && typeof nested === 'object' && nested.value != null) {
          out.push(nested);
        }
      }
      continue;
    }
    if (item.value != null) {
      out.push(item);
    }
  }
  return out;
}

function sortVariantEntries(entries) {
  return [...entries].sort((a, b) => {
    const ai = THOUGHT_LEVEL_ORDER.indexOf(a.level);
    const bi = THOUGHT_LEVEL_ORDER.indexOf(b.level);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.level.localeCompare(b.level);
  });
}

function pickDefaultVariantIndex(sorted, baseId, currentModelId) {
  if (currentModelId) {
    const currentIdx = sorted.findIndex((entry) => `${baseId}-${entry.level}` === currentModelId);
    if (currentIdx >= 0) return currentIdx;
  }
  const medIdx = sorted.findIndex((entry) => entry.level === 'medium');
  if (medIdx >= 0) return medIdx;
  const highIdx = sorted.findIndex((entry) => entry.level === 'high');
  if (highIdx >= 0) return highIdx;
  return 0;
}

/**
 * Convert an ACP `session/new` response (`configOptions` + `models.availableModels`)
 * into Baguette's normalized model catalog with thought-level variants.
 *
 * @param {object | null | undefined} sessionResult
 */
export function mapAcpSessionModels(sessionResult) {
  const configOptions = Array.isArray(sessionResult?.configOptions)
    ? sessionResult.configOptions
    : [];
  const modelOption = configOptions.find(
    (opt) => opt && (opt.id === 'model' || opt.category === 'model') && opt.type === 'select'
  );
  const availableModels = Array.isArray(sessionResult?.models?.availableModels)
    ? sessionResult.models.availableModels
    : [];
  const currentModelId =
    typeof sessionResult?.models?.currentModelId === 'string'
      ? sessionResult.models.currentModelId
      : null;

  const baseOptions = flattenConfigSelectOptions(modelOption?.options);
  if (baseOptions.length > 0) {
    return baseOptions.map((opt) => {
      const baseId = String(opt.value);
      const prefix = `${baseId}-`;
      const matched = [];
      for (const candidate of availableModels) {
        const modelId = typeof candidate?.modelId === 'string' ? candidate.modelId : '';
        if (!modelId.startsWith(prefix)) continue;
        const suffix = modelId.slice(prefix.length).toLowerCase();
        if (!THOUGHT_LEVEL_SET.has(suffix)) continue;
        matched.push({
          level: suffix,
          displayName: candidate.name ?? `${opt.name ?? baseId} (${suffix})`,
          description: candidate.description ?? null,
        });
      }

      if (matched.length === 0) {
        return {
          id: baseId,
          display_name: opt.name ?? baseId,
          description: opt.description ?? null,
          variants: null,
        };
      }

      const sorted = sortVariantEntries(matched);
      const defaultIdx = pickDefaultVariantIndex(sorted, baseId, currentModelId);
      const variants = sorted.map((entry, idx) => ({
        display_name: entry.displayName,
        description: entry.description,
        is_default: idx === defaultIdx,
        params: [{ id: 'reasoning', value: entry.level }],
      }));

      return {
        id: baseId,
        display_name: opt.name ?? baseId,
        description: opt.description ?? null,
        variants,
      };
    });
  }

  return availableModels
    .filter((m) => typeof m?.modelId === 'string' && m.modelId !== '')
    .map((m) => ({
      id: m.modelId,
      display_name: m.name ?? m.modelId,
      description: m.description ?? null,
      variants: null,
    }));
}

/**
 * Open an ephemeral `agy acp` session, authenticate with `gemini-api-key` if needed,
 * and close the session cleanly when done.
 *
 * @param {import('./acp-client.ts').AcpClientLike} client
 * @param {{ apiKey?: string | null, cwd?: string }} [opts]
 */
export async function openEphemeralAcpSession(client, { apiKey = null, cwd = os.tmpdir() } = {}) {
  const init = await client.initialize();
  const tryNewSession = () => client.newSession({ cwd, mcpServers: [] });
  let sessionResult;
  try {
    sessionResult = await tryNewSession();
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : undefined;
    if (code === -32000 && apiKey) {
      await client.authenticate('gemini-api-key');
      sessionResult = await tryNewSession();
    } else {
      throw err;
    }
  }
  return { init, sessionResult };
}

/**
 * List available models for Antigravity via `agy acp`.
 *
 * @param {object | null | undefined} config
 * @param {{ refresh?: boolean, spawnClient?: Function }} [opts]
 */
export async function listAntigravityModels(config, { refresh = false, spawnClient } = {}) {
  const key = modelsCacheKey(config);
  if (refresh) await cache.clear(key);

  return cache.fetch(key, MODELS_CACHE_TTL, async () => {
    const extraEnv = parseExtraEnvJson(config?.extra_env_json);
    const binary = resolveAgyBinary(extraEnv);
    const env = buildAntigravityEnv(config);
    const client = spawnClient
      ? spawnClient({ binary, cwd: os.tmpdir(), env })
      : AcpProcessClient.spawn({ binary, cwd: os.tmpdir(), env });
    const apiKey = typeof config?.api_key === 'string' ? config.api_key.trim() : '';

    try {
      const { sessionResult } = await openEphemeralAcpSession(client, {
        apiKey: apiKey || null,
        cwd: os.tmpdir(),
      });
      if (sessionResult?.sessionId) {
        await client.closeSession(sessionResult.sessionId);
      }
      return mapAcpSessionModels(sessionResult);
    } finally {
      await client.close();
    }
  });
}

/**
 * Clear cached Antigravity model catalog for this config.
 * @param {object | null | undefined} config
 */
export async function clearAntigravityModelsCache(config) {
  await cache.clear(modelsCacheKey(config));
}
