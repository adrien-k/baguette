/**
 * Per-call wall-clock limit for Baguette MCP await tools
 * (AwaitSubagent, AwaitDetachedTask, StartSubagent with attach).
 * Call the same tool again to keep waiting; use StopSubagent / KillTask to cancel.
 */
export const MCP_AWAIT_TIMEOUT_MS = 900_000;

/** @deprecated Use MCP_AWAIT_TIMEOUT_MS */
export const AGENT_TURN_WAIT_TIMEOUT_MS = MCP_AWAIT_TIMEOUT_MS;

export function mcpAwaitTimeoutMinutes() {
  return MCP_AWAIT_TIMEOUT_MS / 60_000;
}

/**
 * @param {{ id?: number, ref?: number } | null | undefined} agent
 */
export function agentTurnWaitTimeoutMessage(agent) {
  const idPart = agent?.id != null ? `agent_id ${agent.id}` : 'the subagent';
  const refPart = agent?.ref != null ? `, ref ${agent.ref}` : '';
  const minutes = mcpAwaitTimeoutMinutes();
  return (
    `Timed out after ${minutes} minutes waiting for ${idPart}${refPart} to finish. ` +
    'The subagent may still be running. Read its last assistant message in the session ' +
    '(GetSessionMessages for that agent) to judge progress, then call AwaitSubagent again to keep waiting or StopSubagent to cancel.'
  );
}

/**
 * @param {{ id?: number, label?: string } | null | undefined} task
 */
export function taskAwaitTimeoutMessage(task) {
  const idPart = task?.id != null ? `task ${task.id}` : 'the task';
  const labelPart = task?.label ? ` (${task.label})` : '';
  const minutes = mcpAwaitTimeoutMinutes();
  return (
    `Timed out after ${minutes} minutes waiting for ${idPart}${labelPart} to exit. ` +
    'The task may still be running. Use ReadTaskOutput or TaskStatus to judge progress, ' +
    'then call AwaitDetachedTask again to keep waiting or KillTask to stop it.'
  );
}
