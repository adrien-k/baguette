import { useEffect, useState } from 'react';
import { AlertCircle, Clock } from 'lucide-react';
import { formatDateTimeWithZone, formatTaskDuration } from '../../utils/dates.js';

/** Re-renders every second, so the countdown stays live. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const STOP_NOTE =
  'You can resume the stopped session after the reset by manually sending a message.';
const WAIT_NOTE = 'Session automatically resumes the work after the limit resets.';
const RESUME_GRACE_MS = 10_000;
const HINT_START = 'To keep going now';
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;

/** Status rows written when a usage limit ends or pauses a turn (see `onUsageLimit`). */
export function isUsageLimitStatus(status: string): boolean {
  return (
    /usage limit/i.test(status) &&
    /(session stopped|waiting for reset|continuing using overage)/i.test(status)
  );
}

/** The notice's main sentence(s) and its trailing "change the action to Continue" hint. */
export function splitUsageLimitHint(status: string): { message: string; hint: string | null } {
  const at = status.indexOf(HINT_START);
  if (at === -1) return { message: status, hint: null };
  return { message: status.slice(0, at).trim(), hint: status.slice(at).trim() };
}

/**
 * Warning row for a usage-limit stop or wait: a clock on the left, the message with its reset time in the browser timezone
 * (with UTC offset) with what happens next underneath, and the live time
 * left until the limit resets (or the resume) on the right. The "change the action to Continue"
 * hint is a plain note below the alert, not part of it.
 */
export default function UsageLimitNotice({
  status,
  resumeAt,
}: {
  status: string;
  /** When set (a waiting session), the countdown and time are for this resume time. */
  resumeAt?: string;
}) {
  const { message, hint } = splitUsageLimitHint(status);
  const stoppedResetIso = message.match(ISO_TIME)?.[0];
  const targetIso = resumeAt ?? stoppedResetIso;
  const target = targetIso ? Date.parse(targetIso) : NaN;
  const hasTarget = !Number.isNaN(target);
  const now = useNow(hasTarget);

  let text = message;
  if (stoppedResetIso && hasTarget) {
    text = message.replace(ISO_TIME, formatDateTimeWithZone(Date.parse(stoppedResetIso)));
  } else if (resumeAt && hasTarget) {
    text = `${message} (${formatDateTimeWithZone(target)})`;
  }
  const remaining = target - now;
  // The resume message is sent at the target time: Resuming… only for a short grace period
  // after it, then it has happened.
  let timer = remaining > -RESUME_GRACE_MS ? 'Resuming…' : 'Resumed';
  if (remaining > 0) timer = formatTaskDuration(remaining);
  if (!resumeAt && remaining <= 0) timer = 'Reset';

  let followUp: string | null = STOP_NOTE;
  if (resumeAt || /waiting for reset/i.test(message)) followUp = WAIT_NOTE;
  if (/continuing using overage/i.test(message)) followUp = null;

  return (
    <div className="w-full">
      <div
        role="alert"
        className="flex w-full items-start gap-3 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-warning/95"
      >
        {hasTarget ? (
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        ) : (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div>{text}</div>
          {followUp ? <div className="mt-1 text-xs opacity-80">{followUp}</div> : null}
        </div>
        {hasTarget ? (
          <span className="shrink-0 font-mono text-xs tabular-nums text-heading mt-0.5">
            {timer}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1 px-1 text-xs text-faint">Hint: {hint}</p> : null}
    </div>
  );
}
