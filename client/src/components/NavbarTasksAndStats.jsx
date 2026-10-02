import RunningTasksDropdown from './RunningTasksDropdown.jsx';
import NavbarSystemStats from './NavbarSystemStats.jsx';
import { useGetTasks } from '../hooks/useGetTasks.js';

/** Running tasks + usage/system stats; separator only when stats render. */
export default function NavbarTasksAndStats() {
  const { tasks: runningTasks } = useGetTasks({ status: 'running' });
  const leadingSeparator = runningTasks.length > 0;
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
      <RunningTasksDropdown />
      <NavbarSystemStats leadingSeparator={leadingSeparator} />
    </div>
  );
}
