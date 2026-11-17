import { BadRequest } from 'feathers/errors';
import { resolveAccountDefaultModel } from '../../shared/agent-default-model.js';

/**
 * The utility model is the account-level cheap model (Settings → Agent) for the small
 * jobs around an agent run — naming sessions, branches, and secondary builders. It
 * replaces the session's builder model for those jobs when configured.
 *
 * Pure resolution only: no DB writes. Callers run the SDK metadata call and decide
 * how to fall back when no utility default is set.
 */

/**
 * Resolve the user's utility model fields.
 * The stored model wins; without one the config's default_model applies
 * (same precedence as the builder/reviewer account defaults).
 *
 * @param {import('knex').Knex} db
 * @param {number | null | undefined} userId
 * @returns {Promise<{ agent_config_id: number, agent_sdk: string, model: string | null, model_params: Array<{ id: string, value: string }> | null } | null>}
 *   null when the user has no utility default (caller applies its own fallback).
 */
export async function resolveUtilityModelDefaults(db, userId) {
  if (userId == null) return null;
  const user = await db('users').where({ id: userId }).first();
  if (!user?.utility_default_config_id) return null;
  const config = await db('agent_configs')
    .where({ id: user.utility_default_config_id, user_id: userId })
    .first();
  if (!config) return null;
  const parsed = resolveAccountDefaultModel(user.utility_default_model, config.default_model);
  return {
    agent_config_id: config.id,
    agent_sdk: config.sdk,
    model: parsed.model,
    model_params: parsed.model_params,
  };
}

/**
 * Registered Feathers agent service for the user's utility model config. The SDK service
 * is chosen by the utility config's SDK — small jobs should not pay for, or depend on,
 * the session's primary builder SDK.
 *
 * @param {object} app Feathers app
 * @param {number | null | undefined} userId
 * @returns {Promise<null | { service: object, agent_config_id: number, agent_sdk: string, model: string | null, model_params: Array<{ id: string, value: string }> | null }>}
 */
export async function getUtilityModelService(app, userId) {
  const defaults = await resolveUtilityModelDefaults(app.get('db'), userId);
  if (!defaults) return null;
  const configs = app.service('agent-configs');
  if (!configs.getSdkMeta(defaults.agent_sdk)) {
    throw new BadRequest(`Agent SDK "${defaults.agent_sdk}" is not registered`);
  }
  return {
    ...defaults,
    service: app.service(configs.servicePathForSdk(defaults.agent_sdk)),
  };
}
