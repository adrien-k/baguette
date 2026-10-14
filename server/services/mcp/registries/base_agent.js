import { createAccountContext } from '../lib/account-context.js';
import { createListIssuesTool } from '../tools/list-issues.js';
import { createReadIssueTool } from '../tools/read-issue.js';
import { createListReposTool } from '../tools/list-repos.js';
import { createListBranchesTool } from '../tools/list-branches.js';
import { createListModelsTool } from '../tools/list-models.js';
import { createListPresetModelsTool } from '../tools/list-preset-models.js';
import { createStartSubagentTool } from '../tools/start-subagent.js';
import { createCreateSessionTool } from '../tools/create-session.js';
import { createSearchSessionsTool } from '../tools/search-sessions.js';
import { createGetSessionTool } from '../tools/get-session.js';
import { createPrReadTool } from '../tools/pr-read.js';
import { createListRunningTasksTool } from '../tools/list-running-tasks.js';
import { createCreateSessionMessageTool } from '../tools/create-session-message.js';
import { createGetSessionMessagesTool } from '../tools/get-session-messages.js';
import { createGetSessionMessageTool } from '../tools/get-session-message.js';
import { createListLoopsTool } from '../tools/list-loops.js';
import { createGetLoopTool } from '../tools/get-loop.js';
import { createCreateLoopTool } from '../tools/create-loop.js';
import { createUpdateLoopTool } from '../tools/update-loop.js';
import { createDeleteLoopTool } from '../tools/delete-loop.js';

function sessionToolsFromContext(ctx) {
  return [
    createSearchSessionsTool(ctx),
    createGetSessionTool(ctx),
    createPrReadTool(ctx),
    createListRunningTasksTool(ctx),
    createCreateSessionMessageTool(ctx),
    createGetSessionMessagesTool(ctx),
    createGetSessionMessageTool(ctx),
  ];
}

function loopToolsFromContext(ctx) {
  return [
    createListLoopsTool(ctx),
    createGetLoopTool(ctx),
    createCreateLoopTool(ctx),
    createUpdateLoopTool(ctx),
    createDeleteLoopTool(ctx),
  ];
}

function issueReadToolsFromContext(ctx) {
  return [createListIssuesTool(ctx), createReadIssueTool(ctx)];
}

/** List/read session review issues (shared by builder, reviewer, and in-session base tools). */
export function buildSessionIssueReadTools(session, app) {
  const ctx = createAccountContext({ id: session.user_id }, app, { callerSession: session });
  return issueReadToolsFromContext(ctx);
}

/** Account- and cross-session MCP tools (external MCP + in-session base layer). */
export function buildBaseAgentTools(user, app, { callerSession = null } = {}) {
  const ctx = createAccountContext(user, app, { callerSession });
  return [
    createListReposTool(ctx),
    createListBranchesTool(ctx),
    createListModelsTool(ctx),
    createListPresetModelsTool(ctx),
    createStartSubagentTool(ctx),
    createCreateSessionTool(ctx),
    ...sessionToolsFromContext(ctx),
    ...loopToolsFromContext(ctx),
    ...issueReadToolsFromContext(ctx),
  ];
}

/** @deprecated Use buildBaseAgentTools */
export function buildBaguetteAccountToolList(user, app, options) {
  return buildBaseAgentTools(user, app, options);
}

export function buildBaguetteSessionMcpTools(user, app, { callerSession = null } = {}) {
  const ctx = createAccountContext(user, app, { callerSession });
  return sessionToolsFromContext(ctx);
}
