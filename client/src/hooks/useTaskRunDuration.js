import { useEffect, useState } from 'react';
import { isTaskRunTimerActive } from '../../../shared/task-status.js';
import { formatTaskDuration, getTaskRunDurationMs } from '../utils/dates.js';

/** Live-updating formatted run time for a task (from created_at until exit or now). */
export function useTaskRunDuration(task) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isTaskRunTimerActive(task?.status)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [task?.id, task?.status]);

  const ms = getTaskRunDurationMs(task, now);
  return ms != null ? formatTaskDuration(ms) : null;
}
