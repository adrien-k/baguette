import { NotFound } from '@feathersjs/errors';
import db from '../db.js';
import { decryptAgentConfigRow } from './agent-config-env.js';

/** User row for agent SDK helpers (credentials live on agent_configs). */
export function userRowForAgentSdk(userRow) {
  if (!userRow) return null;
  return {
    id: userRow.id,
    agent_preferences: userRow.agent_preferences ?? null,
  };
}

/** Load and decrypt an agent_config only if it belongs to `userId`. */
export async function loadOwnedAgentConfigDecrypted(configId, userId, knex = db) {
  if (configId == null) return null;
  const row = await knex('agent_configs').where({ id: configId, user_id: userId }).first();
  if (!row) throw new NotFound('Agent configuration not found');
  return decryptAgentConfigRow(row);
}
