import db from '../db.js';
import { resolveAgentSdkKeys } from '../../shared/agent-sdk-credentials.js';
import { listModels } from './anthropic-models.js';
import { listCursorModels } from './cursor-models.js';
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
 * Models available to the user (SDKs without an API key are omitted), with session usage counts.
 * When `repo` is set, account or repo-level keys apply (same rules as the session builder).
 */
export async function listModelsForUser(user, repo = null) {
  const keys = resolveAgentSdkKeys(user, repo);
  const usage = await getModelUsageCounts(user.id);
  const prefs = parseCursorModelPrefsJson(user.agent_preferences);
  const entries = [];

  if (keys.anthropic_api_key) {
    const models = await listModels();
    for (const m of models) {
      const sessionCount = usage.get(`claude:${m.id}`) ?? 0;
      entries.push({
        sdk: 'claude',
        id: m.id,
        display_name: m.display_name ?? m.id,
        session_count: sessionCount,
      });
    }
  }

  if (keys.cursor_api_key) {
    const models = await listCursorModels(keys.cursor_api_key);
    for (const m of models) {
      const sessionCount = usage.get(`cursor:${m.id}`) ?? 0;
      entries.push({
        sdk: 'cursor',
        id: m.id,
        display_name: m.display_name ?? m.id,
        session_count: sessionCount,
        variants: (m.variants ?? []).map((v, index) => ({
          index,
          display_name: v.display_name,
          is_default: Boolean(v.is_default),
          params: v.params ?? [],
        })),
      });
    }
  }

  entries.sort((a, b) => b.session_count - a.session_count);

  return {
    models: entries,
    cursor_preferences: prefs,
    hint:
      entries.length > 0
        ? 'Models are sorted by how often you have used them in sessions (highest first). Prefer models with higher session_count when unsure.'
        : 'No models available — add an Anthropic or Cursor API key in Settings → Agent, or per-repository keys in repository settings.',
  };
}

export async function loadModelsForSdk(user, agentSdk, repo = null) {
  const keys = resolveAgentSdkKeys(user, repo);
  if (agentSdk === 'cursor') {
    if (!keys.cursor_api_key) return [];
    return listCursorModels(keys.cursor_api_key);
  }
  if (!keys.anthropic_api_key) return [];
  return listModels();
}
