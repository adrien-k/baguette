/** @typedef {'waiting'|'running'|'exiting'|'exited'|'stopped'} TaskStatus */

export function isTaskTerminal(status) {
  return status === 'exited' || status === 'stopped';
}

/** Task is still in flight (not finished). */
export function isTaskActive(status) {
  return status === 'waiting' || status === 'running' || status === 'exiting';
}

/** True when wall-clock run timer should tick (only while the process is up). */
export function isTaskRunTimerActive(status) {
  return status === 'running';
}

export function isTaskStoppable(status) {
  return status === 'waiting' || status === 'running';
}
