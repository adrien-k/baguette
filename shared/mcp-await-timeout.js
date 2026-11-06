/**
 * Per-call wall-clock limit for Baguette MCP wait tools
 * (StartSubagent with attach, AwaitSubagent, AwaitDetachedTask, RunTask without detach).
 * On timeout the call hands back to the calling agent — the underlying subagent or
 * task is *not* cancelled: the wait is virtually detached and it keeps running.
 * The timeout response tells the agent to check progress and continue awaiting
 * with the corresponding tool; kill it only if it looks stuck for no good reason.
 */
export const MCP_AWAIT_TIMEOUT_MS = 1_800_000; // 30 minutes

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
    'The subagent was not cancelled — the wait is detached and the turn keeps running in the background. ' +
    'Read its last assistant message in the session (GetSessionMessages for that agent) to check progress, ' +
    'then call AwaitSubagent again to continue waiting. ' +
    'Use StopSubagent only if it looks stuck for no good reason.'
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
    'The task was not cancelled — the wait is detached and the task keeps running in the background. ' +
    'Use ReadTaskOutput or TaskStatus (with the task id from ListRunningTasks) to check progress, ' +
    'then call AwaitDetachedTask again to continue waiting. ' +
    'Use KillTask only if it looks stuck for no good reason.'
  );
}
