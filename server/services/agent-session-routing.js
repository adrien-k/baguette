import { BadRequest } from '@feathersjs/errors';
import { loadOwnedAgentConfigDecrypted } from './agent-context.js';

async function resolveSessionSdkKey(app, session, { review = false } = {}) {
  const configId = review
    ? (session.review_agent_config_id ?? session.agent_config_id)
    : session.agent_config_id;
  if (configId != null) {
    const config = await loadOwnedAgentConfigDecrypted(configId, session.user_id, app.get('db'));
    return config.sdk;
  }
  const sdk = review ? (session.review_agent_sdk ?? session.agent_sdk) : session.agent_sdk;
  if (!sdk) {
    throw new BadRequest(
      review ? 'review_agent_config_id is required' : 'agent_config_id is required'
    );
  }
  return sdk;
}

/** Feathers path for the session's agent (builder or reviewer config). */
export async function agentServicePathForSession(app, session, opts = {}) {
  const sdk = await resolveSessionSdkKey(app, session, opts);
  const configs = app.service('agent-configs');
  if (!configs.getSdkMeta(sdk)) {
    throw new BadRequest(`Agent SDK "${sdk}" is not registered`);
  }
  return configs.servicePathForSdk(sdk);
}

/** Registered Feathers agent service for a session row. */
export async function getAgentServiceForSession(app, session, opts = {}) {
  const servicePath = await agentServicePathForSession(app, session, opts);
  return app.service(servicePath);
}
