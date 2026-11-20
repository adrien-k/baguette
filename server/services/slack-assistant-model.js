/**
 * Model for a Slack assistant when its owner has no default builder model: Haiku, else Composer,
 * from the owner's own agent configurations (the newest version of the first family found).
 * An owner who set a default model keeps it.
 */
import { BadRequest } from 'feathers/errors';
import {
  MCP_BUILDER_MODEL_SETTINGS_ERROR,
  resolveMcpBuilderModel,
} from './agent-mcp-model-resolver.js';
import { listModelsForOwnedConfig } from './feathers/agent-configs.service.js';

/** Tried in this order. */
const FALLBACK_FAMILIES = [/haiku/i, /composer/i];

const NO_MODEL_ERROR =
  'No default model is set (Settings → Agent), and none of your agent configurations offers Haiku or Composer to fall back on.';

/** "claude-haiku-4-5" → [4, 5]; "Composer 2.5" → [2, 5]; no number → []. */
function versionOf(model) {
  const source = String(model.display_name || model.id || '').replace(/(\d)-(\d)/g, '$1.$2');
  const match = source.match(/\d+(?:\.\d+)*/);
  return match ? match[0].split('.').map(Number) : [];
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Every model the owner's configurations offer; a config with broken credentials offers none. */
async function listCandidates(app, userId) {
  const configs = await app
    .get('db')('agent_configs')
    .where({ user_id: userId })
    .whereNull('deleted_at')
    .orderBy('id', 'asc');
  const candidates = [];
  for (const config of configs) {
    try {
      const { models } = await listModelsForOwnedConfig(app, { configId: config.id, userId });
      for (const model of models ?? []) candidates.push({ config, model });
    } catch {
      // Skipped: the other configurations may still offer a model.
    }
  }
  return candidates;
}

/** The newest model of the first fallback family that any candidate belongs to, or null. */
export function pickFallbackModel(candidates) {
  for (const family of FALLBACK_FAMILIES) {
    const matches = candidates.filter(({ model }) =>
      family.test(`${model.id} ${model.display_name ?? ''}`)
    );
    if (matches.length) {
      return matches.reduce((best, next) =>
        compareVersions(versionOf(next.model), versionOf(best.model)) > 0 ? next : best
      );
    }
  }
  return null;
}

/**
 * Same contract as `resolveMcpBuilderModel`, with the Haiku / Composer fallback when the owner has
 * no default builder model.
 */
export function createAssistantModelResolver(app) {
  return async function resolveAssistantBuilderModel(db, userId, opts = {}) {
    try {
      return await resolveMcpBuilderModel(db, userId, opts);
    } catch (err) {
      if (err.message !== MCP_BUILDER_MODEL_SETTINGS_ERROR) throw err;
    }
    const pick = pickFallbackModel(await listCandidates(app, userId));
    if (!pick) throw new BadRequest(NO_MODEL_ERROR);
    return {
      agent_config_id: pick.config.id,
      agent_sdk: pick.config.sdk,
      model: pick.model.id,
      model_params: null,
    };
  };
}
