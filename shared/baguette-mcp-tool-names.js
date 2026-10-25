/** PascalCase Baguette MCP tool names (builder + base lists). Used for Cursor kind: mcp. */

export const BAGUETTE_MCP_TOOL_NAMES = new Set([
  'ListRepos',
  'ListBranches',
  'ListModels',
  'ListPresetModels',
  'StartSubagent',
  'CreateSession',
  'SearchSessions',
  'GetSession',
  'PrRead',
  'ListRunningTasks',
  'CreateSessionMessage',
  'GetSessionMessages',
  'GetSessionMessage',
  'ListLoops',
  'GetLoop',
  'CreateLoop',
  'UpdateLoop',
  'DeleteLoop',
  'ListIssues',
  'ReadIssue',
  'UpdateIssueStatus',
  'GitPull',
  'GitPush',
  'GitFetch',
  'CurrentSessionInfo',
  'UpdateSession',
  'PrUpsert',
  'PrComments',
  'PrMarkCommentViewed',
  'PrComment',
  'PrReview',
  'PrWorkflows',
  'PrWorkflowLogs',
  'ListGithubPrs',
  'GetGithubPr',
  'AddGithubLabel',
  'ListGithubTags',
  'ListProjectCommands',
  'RunTask',
  'AwaitDetachedTask',
  'TaskStatus',
  'KillTask',
  'ReadTaskOutput',
  'ConfigRepoPrompt',
  'UploadImage',
  'SlackPostMessage',
  'CreateTodo',
  'ProcessTodo',
  'CompleteTodo',
  'ListTodos',
  'CreatePlan',
  'EditPlan',
  'ReadPlan',
]);

export const TURN_ENDING_BAGUETTE_TOOLS = new Set(['AskUserQuestions', 'CreatePlan', 'EditPlan']);

export function baguetteMcpShortName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/^mcp__baguette__/, '');
}

export function isBaguetteMcpToolName(name) {
  const short = baguetteMcpShortName(name) || name;
  if (short === 'AskUserQuestions') return false;
  return BAGUETTE_MCP_TOOL_NAMES.has(short);
}

export function isTurnEndingBaguetteTool(name) {
  const short = baguetteMcpShortName(name) || name;
  return TURN_ENDING_BAGUETTE_TOOLS.has(short);
}

/** CreatePlan/EditPlan `interactive` flag (default true). When false, persist plan without pausing for user approval. */
export function baguettePlanToolIsInteractive(args) {
  if (!args || typeof args !== 'object') return true;
  return args.interactive !== false;
}

/**
 * Whether a successful Baguette MCP tool call should mark the agent awaiting user input.
 * @param {string} name Tool name (short or mcp__baguette__ prefixed)
 * @param {Record<string, unknown> | null | undefined} args
 */
export function baguetteToolPausesForUserAfterSuccess(name, args) {
  if (!isTurnEndingBaguetteTool(name)) return false;
  const short = baguetteMcpShortName(name) || name;
  if ((short === 'CreatePlan' || short === 'EditPlan') && !baguettePlanToolIsInteractive(args)) {
    return false;
  }
  return true;
}
