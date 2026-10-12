import { parseCursorModelPrefsJson } from './agent-preferences.js';
import { loadOwnedAgentConfig } from './agent-config-resolver.js';
import { listModelsForOwnedConfig } from './feathers/agent-configs.service.js';

function parseSessionModelId(modelField) {
  if (!modelField) return null;
  try {
    const parsed = JSON.parse(modelField);
    if (parsed?.id) return parsed.id;
  } catch {
    /* plain id */
  }
  return modelField;
}

/** Session counts per (agent_sdk, model id) for the user. */
export async function getModelUsageCounts(knex, userId) {
  const rows = await knex('sessions')
    .where({ user_id: userId })
    .whereNull('archived_at')
    .select('agent_sdk', 'model');
  const counts = new Map();
  for (const row of rows) {
    const sdk = row.agent_sdk || 'claude';
    const modelId = parseSessionModelId(row.model) || '(default)';
    const key = `${sdk}:${modelId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function modelEntriesFromList(models, sdk, agentConfigId, usage) {
  const entries = [];
  for (const m of models ?? []) {
    const sessionCount = usage.get(`${sdk}:${m.id}`) ?? 0;
    const entry = {
      sdk,
      id: m.id,
      display_name: m.display_name ?? m.id,
      session_count: sessionCount,
      agent_config_id: agentConfigId,
    };
    if (m.variants?.length) {
      entry.variants = m.variants.map((v, index) => ({
        index,
        display_name: v.display_name,
        is_default: Boolean(v.is_default),
        params: v.params ?? [],
      }));
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Models available to the user, with session usage counts.
 *
 * @param {object} user
 * @param {object} repo
 * @param {import('@feathersjs/feathers').Application} app
 */
export async function listModelsForUser(user, repo, app, { agentConfigId = null } = {}) {
  const knex = app.get('db');
  const usage = await getModelUsageCounts(knex, user.id);
  const prefs = parseCursorModelPrefsJson(user.agent_preferences);

  if (agentConfigId != null) {
    const config = await loadOwnedAgentConfig(knex, agentConfigId, user.id);
    const { models } = await listModelsForOwnedConfig(app, {
      configId: agentConfigId,
      userId: user.id,
    });
    const entries = modelEntriesFromList(models, config.sdk, agentConfigId, usage);
    entries.sort((a, b) => b.session_count - a.session_count);
    return {
      models: entries,
      cursor_preferences: prefs,
      agent_config_id: agentConfigId,
      hint:
        entries.length > 0
          ? 'Models are sorted by session usage (highest first).'
          : 'No models available for this agent configuration.',
    };
  }

  const configRows = await knex('agent_configs')
    .where({ user_id: user.id })
    .whereNull('deleted_at')
    .orderBy('label', 'asc');
  const entries = [];
  for (const row of configRows) {
    let models;
    try {
      ({ models } = await listModelsForOwnedConfig(app, { configId: row.id, userId: user.id }));
    } catch {
      continue;
    }
    entries.push(...modelEntriesFromList(models, row.sdk, row.id, usage));
  }

  entries.sort((a, b) => b.session_count - a.session_count);

  return {
    models: entries,
    cursor_preferences: prefs,
    hint:
      entries.length > 0
        ? 'Models are sorted by how often you have used them in sessions (highest first). Prefer models with higher session_count when unsure.'
        : 'No models available — add an agent configuration in Settings → Agent.',
  };
}

/**
 * @param {object} user
 * @param {string} _agentSdk
 * @param {Record<string, unknown>} _repo
 * @param {import('@feathersjs/feathers').Application} app
 */
export async function loadModelsForSdk(user, _agentSdk, _repo, app, { agentConfigId = null } = {}) {
  if (agentConfigId == null) return [];
  const { models } = await listModelsForOwnedConfig(app, {
    configId: agentConfigId,
    userId: user.id,
  });
  return models;
}
