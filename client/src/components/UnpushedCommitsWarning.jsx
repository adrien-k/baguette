import { AlertTriangle } from 'lucide-react';
import { TEXT_FAINT, TINT_WARN_SOFT } from '../utils/ui.js';

export function formatCommitsNotOnAnyRemote(count) {
  return `${count} commit${count !== 1 ? 's' : ''} on HEAD not on any remote`;
}

export default function UnpushedCommitsWarning({ commitsToPush, consequence, hint, commitLabel }) {
  if (!commitsToPush) return null;

  const label = commitLabel ?? `${commitsToPush} unpushed commit${commitsToPush !== 1 ? 's' : ''}`;

  return (
    <>
      <div className={`flex items-start gap-2 text-xs ${TINT_WARN_SOFT} rounded-lg px-3 py-2 mb-4`}>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          This session has <strong>{label}</strong>. {consequence}
        </span>
      </div>
      {hint ? <p className={`${TEXT_FAINT} text-xs mb-4`}>{hint}</p> : null}
    </>
  );
}
