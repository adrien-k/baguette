import { isTurnEndingBaguetteTool } from '../../../../shared/baguette-mcp-tool-names.js';
import { markAwaitingUserAfterTurnEndingTool } from '../../agent-awaiting-user.js';
import { reviewTurnKey } from '../../feathers/session-review.service.js';

function activeSessionStateForSdk(app, sdk, sessionId) {
  const agentService =
    sdk === 'claude'
      ? app.service('claude-agent')
      : sdk === 'cursor'
        ? app.service('cursor-agent')
        : sdk === 'pi'
          ? app.service('pi-agent')
          : null;
  if (!agentService?.getActiveSession) return null;
  return (
    agentService.getActiveSession(sessionId) ??
    agentService.getActiveSession(reviewTurnKey(sessionId)) ??
    null
  );
}

async function markAwaitingUserAfterTurnEndingBaguetteTool(app, session) {
  const sessionId = session.id;
  const userId = session.user_id;
  const row = await app.get('db')('sessions').where({ id: sessionId }).first();
  const sdk = row?.agent_sdk ?? session.agent_sdk;
  const sessionState = activeSessionStateForSdk(app, sdk, sessionId);
  await markAwaitingUserAfterTurnEndingTool(app, sessionId, userId, sessionState);
}

function wrapBaguetteToolHandler(session, app, name, handler) {
  return async (args) => {
    const result = await handler(args);
    if (isTurnEndingBaguetteTool(name)) {
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
