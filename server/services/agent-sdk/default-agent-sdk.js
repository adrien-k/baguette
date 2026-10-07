import { BadRequest } from '@feathersjs/errors';
import { requireRepoAccessForUserDb, userRowForAgentSdk } from './agent-context.js';

/** `{ user, repo? }` for `agent-sdks.listEnabled`. */
export async function agentSdkContextForSession(app, session) {
  const db = app.get('db');
  const row = await db('users').where({ id: session.user_id }).first();
  const user = userRowForAgentSdk(row);
  if (!user) throw new BadRequest('User not found');
  let repo = null;
  if (session.repo_id != null) {
    repo = await requireRepoAccessForUserDb(db, session.repo_id, session.user_id);
  }
  return { user, repo };
}

export async function firstEnabledAgentSdkKey(app, ctx) {
  const enabled = await app.service('agent-sdks').listEnabled(ctx);
  return enabled[0]?.key ?? null;
}

/**
 * Prefer an enabled `sdkKey`; otherwise the first enabled SDK for this user/repo.
 * @returns {Promise<string | null>}
 */
export async function resolveAgentSdkKey(app, sdkKey, ctx) {
  const registry = app.service('agent-sdks');
  if (sdkKey && registry.getMeta(sdkKey) && (await registry.isEnabled(sdkKey, ctx))) {
    return sdkKey;
  }
  return firstEnabledAgentSdkKey(app, ctx);
}

export async function agentServicePathForSdk(app, agentSdk, ctx) {
  const key = await resolveAgentSdkKey(app, agentSdk, ctx);
  if (!key) throw new BadRequest('No agent SDK is available for this account');
  return app.service('agent-sdks').servicePathFor(key);
}

/** Registered Feathers agent service for a session row (and optional SDK override). */
export async function getAgentServiceForSession(app, session, sdkKey = session.agent_sdk) {
  const ctx = await agentSdkContextForSession(app, session);
  const servicePath = await agentServicePathForSdk(app, sdkKey, ctx);
  return app.service(servicePath);
}
