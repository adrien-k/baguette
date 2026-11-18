import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { formatTaskDuration } from '../../utils/dates.js';

/** Re-renders every second until `resumeAt`, so the countdown stays live. */
function useRemainingMs(resumeAt: string): number {
  const target = Date.parse(resumeAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return target - now;
}

/** Status row for a session waiting out a usage limit: icon, live countdown, then the notice. */
export default function UsageLimitNotice({
  status,
  resumeAt,
}: {
  status: string;
  resumeAt: string;
}) {
  const remaining = useRemainingMs(resumeAt);
  const timer = remaining > 0 ? formatTaskDuration(remaining) : 'Resuming…';
  return (
    <div className="mx-auto flex max-w-fit items-center gap-2 rounded-md border border-line/60 bg-control/40 px-3 py-1.5 text-xs text-fg-muted">
      <Clock className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <span className="font-mono tabular-nums text-heading">{timer}</span>
      <span>{status}</span>
    </div>
  );
}
