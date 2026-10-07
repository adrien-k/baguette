import { BadRequest } from '@feathersjs/errors';
import db from '../db.js';
import { parseCursorModelPrefsJson } from './agent-preferences.js';

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
export async function getModelUsageCounts(userId) {
  const rows = await db('sessions')
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

/**
 * Models available to the user (SDKs without credentials omitted), with session usage counts.
 * Account or repo-level keys apply for the given repository.
 *
 * @param {object} user
 * @param {object} repo
 * @param {import('@feathersjs/feathers').Application} app
 */
export async function listModelsForUser(user, repo, app) {
  if (repo?.id == null) {
    throw new BadRequest('repo_id is required');
  }
  const usage = await getModelUsageCounts(user.id);
  const prefs = parseCursorModelPrefsJson(user.agent_preferences);
  const entries = [];
  const ctx = { user, repo };
  const enabled = await app.service('agent-sdks').listEnabled(ctx);

  for (const { key } of enabled) {
    const models = await app.service('agent-sdks').listModelsForSdk(key, ctx);
    if (!models?.length) continue;
    for (const m of models) {
      const sessionCount = usage.get(`${key}:${m.id}`) ?? 0;
      const entry = {
        sdk: key,
        id: m.id,
        display_name: m.display_name ?? m.id,
        session_count: sessionCount,
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
  }

  entries.sort((a, b) => b.session_count - a.session_count);

  return {
    models: entries,
    cursor_preferences: prefs,
    hint:
      entries.length > 0
        ? 'Models are sorted by how often you have used them in sessions (highest first). Prefer models with higher session_count when unsure.'
        : 'No models available — add an Anthropic, Cursor, or Pi API key in Settings → Agent, or per-repository keys in repository settings.',
  };
}

/**
 * @param {object} user
 * @param {string} agentSdk
 * @param {Record<string, unknown>} repo
 * @param {import('@feathersjs/feathers').Application} app
 */
export async function loadModelsForSdk(user, agentSdk, repo, app) {
  if (repo?.id == null) {
    throw new BadRequest('repo_id is required');
  }
  const models = await app
    .service('agent-sdks')
    .listModelsForSdk(agentSdk, { user, repo }, { refresh: false });
  return models ?? [];
}
