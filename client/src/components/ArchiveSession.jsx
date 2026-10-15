import { useState } from 'react';
import { Archive, Loader2 } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { fetchSessionCommitsToPush } from '../utils/sessionCommitsToPush.js';

export default function ArchiveSession({ session, onArchive }) {
  const [archiving, setArchiving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [unpushedCount, setUnpushedCount] = useState(0);

  const isProvisioning = session.status === 'provisioning';
  const isArchiving = session.status === 'archiving';
  const blocked = archiving || isArchiving;
  const hasDraftPr = session.pr_status === 'draft' && session.pr_number;

  const performArchive = async ({ closePr = false } = {}) => {
    setArchiving(true);
    try {
      const query = closePr ? { close_pr: true } : {};
      await sessionsService.archive(session.id, { query });
      onArchive?.();
    } catch (err) {
      toastError('Failed to archive session', err);
      setArchiving(false);
    }
  };

  const handleArchive = async (e) => {
    e.stopPropagation();
    if (blocked || checking) return;

    setChecking(true);
    try {
      const commitsToPush = await fetchSessionCommitsToPush(session);
      setUnpushedCount(commitsToPush);
    } catch (err) {
      toastError('Failed to check git status', err);
      setChecking(false);
      return;
    }
    setChecking(false);

    const closePr = hasDraftPr;
    await performArchive({ closePr });
  };

  const buttonTitle = (() => {
    if (checking) return 'Checking for unpushed commits…';
    if (archiving || isArchiving) return 'Archiving…';
    if (isProvisioning) return 'Archive provisioning session';
    const parts = ['Archive session'];
    if (unpushedCount > 0) {
      parts.push(
        `${unpushedCount} unpushed commit${unpushedCount === 1 ? '' : 's'} will stay local only`
      );
    }
    if (hasDraftPr) {
      parts.push(`close draft PR #${session.pr_number}`);
    }
    return parts.join(' · ');
  })();

  const iconButtonClass =
    'p-1 text-faint hover:text-accent hover:bg-control rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <button
      type="button"
      onClick={handleArchive}
      disabled={blocked || checking}
      title={buttonTitle}
      className={iconButtonClass}
    >
      {archiving || isArchiving || checking ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
      ) : (
        <Archive className="w-3.5 h-3.5 shrink-0" />
      )}
    </button>
  );
}
