/** Built-in Claude Code delegation tools — not tracked as Baguette session agents. */
const CLAUDE_SDK_SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

export const CLAUDE_SDK_SUBAGENT_DENIED_MESSAGE =
  'Claude Code’s built-in Agent/Task subagent is not available in Baguette. ' +
  'Delegate work with the Baguette MCP tool StartSubagent instead (ListAgents, AwaitAgent, StopSubagent for follow-up).';

/**
 * @param {string} toolName
 */
export function isClaudeSdkSubagentTool(toolName) {
  return CLAUDE_SDK_SUBAGENT_TOOL_NAMES.has(toolName);
}

/**
 * @param {string} toolName
 * @returns {{ behavior: 'deny', message: string } | null}
 */
export function claudeSdkSubagentDenyResult(toolName) {
  if (!isClaudeSdkSubagentTool(toolName)) return null;
  return { behavior: 'deny', message: CLAUDE_SDK_SUBAGENT_DENIED_MESSAGE };
}
