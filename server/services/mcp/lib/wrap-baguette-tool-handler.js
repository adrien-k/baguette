import { isTurnEndingBaguetteTool } from '../../../../shared/baguette-mcp-tool-names.js';
import { baguetteMcpToolSucceeded } from '../../baguette-mcp-tool-result.js';
import { markAwaitingUserAfterTurnEndingTool } from '../../agent-awaiting-user.js';
import { getPrimaryBuilderAgent, getReviewerAgent } from '../../agents-db.js';
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

  const builder = await getPrimaryBuilderAgent(db, sessionId);
  if (builder?.agent_sdk) {
    candidates.push({ sdk: builder.agent_sdk, keys: [sessionId], agentId: builder.id });
  }
  const reviewer = await getReviewerAgent(db, sessionId);
  if (reviewer?.agent_sdk) {
    candidates.push({
      sdk: reviewer.agent_sdk,
      keys: [reviewTurnKey(reviewer.id)],
      agentId: reviewer.id,
    });
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
    if (isTurnEndingBaguetteTool(name) && baguetteMcpToolSucceeded(result)) {
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
