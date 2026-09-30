/** @param {{ is_docker?: boolean; command?: string } | null | undefined} task */
export function isDockerTask(task) {
  if (!task) return false;
  if (task.is_docker) return true;
  return typeof task.command === 'string' && task.command.startsWith('docker:');
}
