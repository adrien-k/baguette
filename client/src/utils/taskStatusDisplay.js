export {
  isTaskActive,
  isTaskRunTimerActive,
  isTaskStoppable,
  isTaskTerminal,
} from '../../../shared/task-status.js';

export function taskStatusDotClass(status) {
  switch (status) {
    case 'running':
      return 'bg-ok animate-pulse';
    case 'waiting':
    case 'exiting':
      return 'bg-task-pending-bg animate-pulse';
    default:
      return 'bg-track';
  }
}

/** Right-side status label in the task list / modal header. */
export function taskStatusEndLabel(status, exitCode) {
  switch (status) {
    case 'waiting':
      return { text: 'waiting', className: 'text-task-pending' };
    case 'exiting':
      return { text: 'exiting', className: 'text-task-pending' };
    case 'stopped':
      return { text: 'stopped', className: 'text-faint' };
    case 'exited':
      return {
        text: `exit ${exitCode}`,
        className: exitCode === 0 ? 'text-success' : 'text-danger',
      };
    default:
      return null;
  }
}
