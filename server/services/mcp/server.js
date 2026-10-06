import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  GLOBAL_SESSION_EXCLUDED_MCP_TOOLS,
  isGlobalSession,
} from '../../../shared/session-scope.js';
import { loadConfiguredSlackApps } from './lib/slack.js';
import { buildBaseAgentTools } from './registries/base_agent.js';
import { buildBuilderAgentTools } from './registries/builder_agent.js';
import { buildReviewerAgentTools } from './registries/reviewer_agent.js';

/**
 * Creates tool definitions shared between Claude SDK MCP server and Cursor customTools.
 * Returns an array of { name, description, schema (Zod shape), handler }.
 *
 * Slack tools are included only when at least one Slack app has a bot token.
 */
export async function buildBaguetteToolList(session, app, { slackApps = [] } = {}) {
  let baseTools = [];
  try {
    const owner = await app.service('users').get(session.user_id, {});
    baseTools = buildBaseAgentTools(owner, app, { callerSession: session });
  } catch {
    baseTools = [];
  }

  const tools = [...baseTools, ...buildBuilderAgentTools(session, app, { slackApps })];

  if (isGlobalSession(session)) {
    const excluded = new Set(GLOBAL_SESSION_EXCLUDED_MCP_TOOLS);
    return tools.filter((t) => !excluded.has(t.name));
  }
  return tools;
}

export async function buildBaguetteMcpServer(session, app) {
  const slackApps = await loadConfiguredSlackApps(app);
  const toolList = await buildBaguetteToolList(session, app, { slackApps });
  return createSdkMcpServer({
    name: 'baguette',
    tools: toolList.map(({ name, description, schema, handler }) =>
      tool(name, description, schema, handler)
    ),
  });
}

function toolListToCursorCustomTools(toolList) {
  return Object.fromEntries(
    toolList.map(({ name, description, schema, handler }) => {
      const hasSchema = Object.keys(schema).length > 0;
      const inputSchema = hasSchema ? z.toJSONSchema(z.object(schema)) : undefined;
      return [name, { description, inputSchema, execute: (args) => handler(args) }];
    })
  );
}

export async function buildCursorCustomTools(session, app) {
  const slackApps = await loadConfiguredSlackApps(app);
  const toolList = await buildBaguetteToolList(session, app, { slackApps });
  return toolListToCursorCustomTools(toolList);
}

export function buildReviewerMcpServer(session, app, turnAgent = {}) {
  const toolList = buildReviewerAgentTools(session, app, turnAgent);
  return createSdkMcpServer({
    name: 'baguette',
    tools: toolList.map(({ name, description, schema, handler }) =>
      tool(name, description, schema, handler)
    ),
  });
}

export function buildReviewerCursorCustomTools(session, app, turnAgent = {}) {
  return toolListToCursorCustomTools(buildReviewerAgentTools(session, app, turnAgent));
}
