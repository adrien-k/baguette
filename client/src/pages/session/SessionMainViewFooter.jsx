import { Bot } from 'lucide-react';
import { isGlobalSession } from '@baguette/shared/session-scope.js';

function runningTasksLabel(count) {
  if (count === 1) return '1 task running';
  return `${count} tasks running`;
}

export default function SessionMainViewFooter({ session, onShowTasks, onShowReviewer }) {
  if (!session) return null;

  const runningTasksCount = session.running_tasks_count ?? 0;
  const showRunningTaskFooter = runningTasksCount > 0;
  const showReviewFooter = !isGlobalSession(session) && session.review_status === 'running';

  if (!showRunningTaskFooter && !showReviewFooter) return null;

  return (
    <div className="shrink-0 border-t border-line bg-nav flex items-center gap-1 min-w-0 px-3 sm:px-4 py-0.5">
      {showRunningTaskFooter && (
        <button
          type="button"
          onClick={onShowTasks}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-control/50 transition-colors"
          title="Show tasks"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse shrink-0" />
          <span className="text-[11px] text-secondary whitespace-nowrap">
            {runningTasksLabel(runningTasksCount)}
          </span>
        </button>
      )}
      {showReviewFooter && (
        <button
          type="button"
          onClick={onShowReviewer}
          className="flex cursor-pointer items-center gap-1.5 shrink-0 rounded px-1.5 py-1 ml-auto hover:bg-control/50 transition-colors"
          title="Review in progress"
        >
          <Bot className="w-3.5 h-3.5 text-accent motion-safe:animate-pulse" aria-hidden />
          <span className="text-[11px] font-medium text-heading whitespace-nowrap">
            Review in progress
          </span>
        </button>
      )}
    </div>
  );
}
