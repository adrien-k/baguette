import { useEffect, useState } from 'react';
import { formatTaskDuration } from '../../utils/dates.js';

function useNowTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Elapsed wall time since a tool call started (for running Bash headers). */
export default function ToolRunElapsed({
  startedAt,
  className = 'text-faint text-xs font-mono shrink-0',
}) {
  const now = useNowTick(1000);
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const formatted = formatTaskDuration(Math.max(0, now - start));
  if (!formatted) return null;
  return <span className={className}>{formatted}</span>;
}
