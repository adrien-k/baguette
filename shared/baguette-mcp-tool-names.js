/** PascalCase Baguette MCP tool names (builder + base lists). Used for Cursor kind: mcp. */

export const BAGUETTE_MCP_TOOL_NAMES = new Set([
  'ListRepos',
  'ListBranches',
  'ListModels',
  'ListPresetModels',
  'StartBuilderAgent',
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
  'ShowDiff',
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
