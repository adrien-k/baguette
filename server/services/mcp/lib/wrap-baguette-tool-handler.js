import { baguetteToolPausesForUserAfterSuccess } from '../../../../shared/baguette-mcp-tool-names.js';
import { baguetteMcpToolSucceeded } from '../../baguette-mcp-tool-result.js';
import { markAwaitingUserAfterTurnEndingTool } from '../../agent-awaiting-user.js';
import { builderChatActiveKey, listAgentsForSession } from '../../agents-db.js';
import { reviewTurnKey } from '../../review-agent-turn.js';
import { servicePathForSdk } from '../../../agent-sdks/registry.js';
import { ensureBuiltInSdkPluginsRegistered } from '../../../agent-sdks/ensure-builtins-registered.js';

async function agentServiceForSdk(app, sdk) {
  await ensureBuiltInSdkPluginsRegistered();
  const path = servicePathForSdk(sdk);
  try {
    return app.service(path);
  } catch {
    return null;
  }
}

async function resolveActiveSessionState(app, sessionId) {
  const db = app.get('db');
  const candidates = [];

  const agents = await listAgentsForSession(db, sessionId);
  for (const agent of agents) {
    if (!agent.agent_sdk) continue;
    if (agent.agent_type === 'reviewer') {
      candidates.push({
        sdk: agent.agent_sdk,
        keys: [reviewTurnKey(agent.id)],
        agentId: agent.id,
      });
    } else if (agent.agent_type === 'builder' || agent.agent_type === 'subagent') {
      candidates.push({
        sdk: agent.agent_sdk,
        keys: [builderChatActiveKey(agent)],
        agentId: agent.id,
      });
    }
  }

  for (const { sdk, keys, agentId } of candidates) {
    const agentService = await agentServiceForSdk(app, sdk);
    if (!agentService?.getActiveSession) continue;
    for (const key of keys) {
      const state = agentService.getActiveSession(key);
      if (state) {
        if (!state.agentId) state.agentId = agentId;
        return state;
      }
    }
  }
  return null;
}

async function markAwaitingUserAfterTurnEndingBaguetteTool(app, session) {
  const sessionId = session.id;
  const userId = session.user_id;
  const sessionState = await resolveActiveSessionState(app, sessionId);
  await markAwaitingUserAfterTurnEndingTool(app, sessionId, userId, sessionState);
}

function wrapBaguetteToolHandler(session, app, name, handler) {
  return async (args) => {
    const result = await handler(args);
    if (baguetteToolPausesForUserAfterSuccess(name, args) && baguetteMcpToolSucceeded(result)) {
      await markAwaitingUserAfterTurnEndingBaguetteTool(app, session);
    }
    return result;
  };
}

export function wrapBaguetteToolList(session, app, toolList) {
  return toolList.map(({ name, description, schema, handler }) => ({
    name,
    description,
    schema,
    handler: wrapBaguetteToolHandler(session, app, name, handler),
  }));
}
