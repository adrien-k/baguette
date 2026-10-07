import { AlertTriangle } from 'lucide-react';
import { TEXT_FAINT, TINT_WARN_SOFT } from '../utils/ui.js';

export default function UnpushedCommitsWarning({ commitsToPush, consequence, hint }) {
  if (!commitsToPush) return null;

  const commitLabel = `${commitsToPush} unpushed commit${commitsToPush !== 1 ? 's' : ''}`;

  return (
    <>
      <div className={`flex items-start gap-2 text-xs ${TINT_WARN_SOFT} rounded-lg px-3 py-2 mb-4`}>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          This session has <strong>{commitLabel}</strong>. {consequence}
        </span>
      </div>
      {hint ? <p className={`${TEXT_FAINT} text-xs mb-4`}>{hint}</p> : null}
    </>
  );
}
