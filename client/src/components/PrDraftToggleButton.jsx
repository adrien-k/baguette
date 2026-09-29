import { useState } from 'react';
import { GitPullRequest, GitPullRequestDraft } from 'lucide-react';
import toast from 'react-hot-toast';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { NEUTRAL_BUTTON_CLASS } from '../utils/buttonStyles.js';

export function canTogglePrDraftStatus(session) {
  if (!session?.pr_number) return false;
  const status = session.pr_status ?? 'open';
  return status === 'draft' || status === 'open';
}

export default function PrDraftToggleButton({ session, className = NEUTRAL_BUTTON_CLASS }) {
  const [toggling, setToggling] = useState(false);

  if (!canTogglePrDraftStatus(session)) return null;

  const isDraft = session.pr_status === 'draft';
  const Icon = isDraft ? GitPullRequest : GitPullRequestDraft;
  const label = isDraft ? 'Mark ready' : 'Mark draft';

  const handleClick = async () => {
    if (!session?.id || toggling) return;
    setToggling(true);
    try {
      await sessionsService.setPrDraft({ id: session.id, draft: !isDraft });
      toast.success(
        isDraft ? 'Pull request marked ready for review' : 'Pull request marked as draft'
      );
    } catch (err) {
      toastError(
        isDraft ? 'Failed to mark pull request ready' : 'Failed to mark pull request as draft',
        err
      );
    } finally {
      setToggling(false);
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={toggling} className={className}>
      <Icon className="w-3.5 h-3.5" />
      {toggling ? '…' : label}
    </button>
  );
}
