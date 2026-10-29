import { baguetteToolPausesForUserAfterSuccess } from '../../../../shared/baguette-mcp-tool-names.js';
import { baguetteMcpToolSucceeded } from '../../baguette-mcp-tool-result.js';
import { markAwaitingUserAfterTurnEndingTool } from '../../agent-awaiting-user.js';
import { builderChatActiveKey, listAgentsForSession } from '../../agents-db.js';
import { reviewTurnKey } from '../../review-agent-turn.js';

function agentServiceForSdk(app, sdk) {
  if (sdk === 'claude') return app.service('claude-agent');
  if (sdk === 'cursor') return app.service('cursor-agent');
  if (sdk === 'pi') return app.service('pi-agent');
  return null;
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
    const agentService = agentServiceForSdk(app, sdk);
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
