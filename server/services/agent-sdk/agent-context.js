import { BadRequest } from '@feathersjs/errors';
import { decrypt } from '../../lib/encrypt.js';
import db from '../../db.js';

/** Model listing always uses a linked repository (repo keys + account fallback). */
export function assertRepoContext(ctx) {
  if (ctx?.repo?.id == null) {
    throw new BadRequest('repo_id is required');
  }
}

/** User row with decrypted agent credential fields for SDK enablement and model listing. */
export function userRowForAgentSdk(userRow) {
  if (!userRow) return null;
  return {
    id: userRow.id,
    anthropic_api_key: userRow.anthropic_api_key_encrypted
      ? decrypt(userRow.anthropic_api_key_encrypted)
      : null,
    anthropic_auth_token: userRow.anthropic_auth_token_encrypted
      ? decrypt(userRow.anthropic_auth_token_encrypted)
      : null,
    anthropic_base_url: userRow.anthropic_base_url ?? null,
    cursor_api_key: userRow.cursor_api_key_encrypted
      ? decrypt(userRow.cursor_api_key_encrypted)
      : null,
    agent_preferences: userRow.agent_preferences ?? null,
  };
}

export async function loadUserForAgentSdk(userId) {
  const row = await db('users').where({ id: userId }).first();
  return userRowForAgentSdk(row);
}

/** Repo row with decrypted per-repo agent keys. */
export function repoRowForAgentSdk(repoRow) {
  if (!repoRow) return null;
  return {
    id: repoRow.id,
    full_name: repoRow.full_name,
    anthropic_api_key: repoRow.anthropic_api_key_encrypted
      ? decrypt(repoRow.anthropic_api_key_encrypted)
      : null,
    anthropic_auth_token: repoRow.anthropic_auth_token_encrypted
      ? decrypt(repoRow.anthropic_auth_token_encrypted)
      : null,
    anthropic_base_url: repoRow.anthropic_base_url ?? null,
    cursor_api_key: repoRow.cursor_api_key_encrypted
      ? decrypt(repoRow.cursor_api_key_encrypted)
      : null,
  };
}

/** Repo row with decrypted per-repo agent keys (caller must enforce access). */
export async function loadRepoWithKeysForAgent(repoId) {
  const repo = await db('repos').where({ id: repoId }).first();
  return repoRowForAgentSdk(repo);
}

export async function requireRepoAccessForUser(repoId, userId) {
  return requireRepoAccessForUserDb(db, repoId, userId);
}

export async function requireRepoAccessForUserDb(knex, repoId, userId) {
  const link = await knex('user_repos').where({ user_id: userId, repo_id: repoId }).first();
  if (!link) return null;
  const repo = await knex('repos').where({ id: repoId }).first();
  return repoRowForAgentSdk(repo);
}
