import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { Type } from 'typebox';
import {
  GLOBAL_SESSION_EXCLUDED_MCP_TOOLS,
  isGlobalSession,
} from '../../../shared/session-scope.js';
import { loadConfiguredSlackApps } from './lib/slack.js';
import { buildBaseAgentTools } from './registries/base_agent.js';
import { buildBuilderAgentTools } from './registries/builder_agent.js';
import { buildReviewerAgentTools } from './registries/reviewer_agent.js';
import { parsePiToolParams } from './lib/pi-tool-params.js';
import { wrapBaguetteToolList } from './lib/wrap-baguette-tool-handler.js';

/**
 * Creates tool definitions shared between Claude SDK MCP server and Cursor customTools.
 * Returns an array of { name, description, schema (Zod shape), handler }.
 *
 * Slack tools are included only when at least one Slack app has a bot token.
 */
async function buildBaguetteToolList(session, app, { slackApps = [] } = {}) {
  let baseTools = [];
  try {
    const owner = await app.service('users').get(session.user_id, {});
    baseTools = buildBaseAgentTools(owner, app, { callerSession: session });
  } catch {
    baseTools = [];
  }

  const tools = [...baseTools, ...buildBuilderAgentTools(session, app, { slackApps })];

  const wrapped = wrapBaguetteToolList(session, app, tools);
  if (isGlobalSession(session)) {
    const excluded = new Set(GLOBAL_SESSION_EXCLUDED_MCP_TOOLS);
    return wrapped.filter((t) => !excluded.has(t.name));
  }
  return wrapped;
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

function mcpResultToPiText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (result && Array.isArray(result.content)) {
    const parts = result.content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text);
    if (parts.length === 1) return parts[0];
    if (parts.length > 0) return parts.join('\n\n');
  }
  return JSON.stringify(result, null, 2);
}

function piToolParameters(schema) {
  const shape = schema && typeof schema === 'object' ? schema : {};
  if (Object.keys(shape).length === 0) {
    return Type.Object({}, { additionalProperties: true });
  }
  const jsonSchema = z.toJSONSchema(z.object(shape));
  return {
    ...jsonSchema,
    type: jsonSchema.type ?? 'object',
    ...(jsonSchema.properties === undefined ? { properties: {} } : {}),
  };
}

function toolListToPiCustomTools(toolList) {
  return toolList.map(({ name, description, schema, handler }) =>
    defineTool({
      name,
      label: name,
      description,
      parameters: piToolParameters(schema),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const shape = schema && typeof schema === 'object' ? schema : {};
        const parsed = parsePiToolParams(shape, params);
        const result = await handler(parsed);
        const text = mcpResultToPiText(result);
        return {
          content: [{ type: 'text', text }],
          details: {},
        };
      },
    })
  );
}

export async function buildPiCustomTools(session, app, { channel = 'chat' } = {}) {
  if (channel === 'review') {
    return buildReviewerPiCustomTools(session, app);
  }
  const slackApps = await loadConfiguredSlackApps(app);
  const toolList = await buildBaguetteToolList(session, app, { slackApps });
  return toolListToPiCustomTools(toolList);
}

export function buildReviewerPiCustomTools(session, app, turnAgent = {}) {
  return toolListToPiCustomTools(buildReviewerAgentTools(session, app, turnAgent));
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
