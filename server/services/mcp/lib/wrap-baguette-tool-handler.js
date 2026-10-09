import { isTurnEndingBaguetteTool } from '../../../../shared/baguette-mcp-tool-names.js';

function endTurnAfterBaguetteTool(app, session) {
  const sessionId = session.id;
  const sdk = session.agent_sdk;
  try {
    if (sdk === 'claude') {
      app.service('claude-agent')?.endTurnAfterBaguetteTool?.(sessionId);
    } else if (sdk === 'cursor') {
      app.service('cursor-agent')?.endTurnAfterBaguetteTool?.(sessionId);
    } else if (sdk === 'pi') {
      app.service('pi-agent')?.endTurnAfterBaguetteTool?.(sessionId);
    }
  } catch {
    // ignore — turn may already be idle
  }
}

export function wrapBaguetteToolHandler(session, app, name, handler) {
  return async (args) => {
    const result = await handler(args);
    if (isTurnEndingBaguetteTool(name)) {
      const row = await app.get('db')('sessions').where({ id: session.id }).first();
      endTurnAfterBaguetteTool(app, row ?? session);
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
