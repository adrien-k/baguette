import { BadRequest } from '@feathersjs/errors';
import { loadOwnedAgentConfigDecrypted } from './agent-context.js';
import { getAgentById } from './agents-db.js';

async function resolveAgentSdkKey(app, agent) {
  const configId = agent.agent_config_id;
  if (configId != null) {
    const session = await app.get('db')('sessions').where({ id: agent.session_id }).first();
    const config = await loadOwnedAgentConfigDecrypted(configId, session.user_id, app.get('db'));
    return config.sdk;
  }
  const sdk = agent.agent_sdk;
  if (!sdk) {
    throw new BadRequest('agent_config_id is required');
  }
  return sdk;
}

/** Feathers path for an agent row's SDK. */
async function agentServicePathForAgent(app, agent) {
  const sdk = await resolveAgentSdkKey(app, agent);
  const configs = app.service('agent-configs');
  if (!configs.getSdkMeta(sdk)) {
    throw new BadRequest(`Agent SDK "${sdk}" is not registered`);
  }
  return configs.servicePathForSdk(sdk);
}

/** Registered Feathers agent service for an agents row. */
export async function getAgentServiceForAgent(app, agent) {
  const servicePath = await agentServicePathForAgent(app, agent);
  return app.service(servicePath);
}

/**
 * @deprecated Use getAgentServiceForAgent with the message's agent row.
 * Loads agent from row.agent_id when present.
 */
/** @deprecated Prefer agentServicePathForAgent with an agents row. */
export async function agentServicePathForSession(app, session, opts = {}) {
  const db = app.get('db');
  let agent;
  if (opts.review) {
    agent = await db('agents').where({ session_id: session.id, agent_type: 'reviewer' }).first();
  } else {
    agent = await db('agents').where({ session_id: session.id, is_primary: 1 }).first();
  }
  if (!agent) {
    throw new BadRequest('Agent not found for session');
  }
  return agentServicePathForAgent(app, agent);
}

export async function getAgentServiceForSession(app, session, opts = {}) {
  const db = app.get('db');
  let agent;
  if (opts.agentId != null) {
    agent = await getAgentById(db, opts.agentId);
  } else if (opts.review) {
    agent = await db('agents').where({ session_id: session.id, agent_type: 'reviewer' }).first();
  } else {
    agent = await db('agents').where({ session_id: session.id, is_primary: 1 }).first();
  }
  if (!agent) {
    throw new BadRequest('Agent not found for session');
  }
  return getAgentServiceForAgent(app, agent);
}
