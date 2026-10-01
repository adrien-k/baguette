import { coerceModelParams } from '../../shared/agent-session-defaults.js';

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

/** Most recent non-archived session harness for the user (account-wide). */
export async function getLastUsedSessionAgent(db, userId) {
  const row = await db('sessions')
    .where({ user_id: userId })
    .whereNull('archived_at')
    .where((b) => b.whereNotNull('agent_sdk').orWhereNotNull('model'))
    .orderByRaw('COALESCE(last_activity_at, updated_at, created_at) DESC')
    .select('agent_sdk', 'model', 'model_params')
    .first();
  if (!row) return null;
  return {
    agent_sdk: row.agent_sdk || 'claude',
    model: parseSessionModelId(row.model),
    model_params: coerceModelParams(row.model_params),
  };
}
