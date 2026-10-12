import { useState } from 'react';
import { Archive, Loader2 } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { fetchSessionCommitsToPush } from '../utils/sessionCommitsToPush.js';
import ArchiveConfirmModal from './ArchiveConfirmModal.jsx';

export default function ArchiveSession({ session, onArchive }) {
  const [archiving, setArchiving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [unpushedCount, setUnpushedCount] = useState(0);

  const isProvisioning = session.status === 'provisioning';
  const isArchiving = session.status === 'archiving';
  const blocked = archiving || checking || isArchiving;
  const hasDraftPr = session.pr_status === 'draft' && session.pr_number;

  const performArchive = async ({ closePr = false } = {}) => {
    setArchiving(true);
    try {
      const query = closePr ? { close_pr: true } : {};
      await sessionsService.remove(session.id, { query });
      setShowConfirm(false);
      onArchive?.();
    } catch (err) {
      toastError('Failed to archive session', err);
      setArchiving(false);
    }
  };

  const handleClick = async (e) => {
    e.stopPropagation();
    if (blocked) return;

    if (isProvisioning) {
      await performArchive();
      return;
    }

    setChecking(true);
    try {
      const commitsToPush = await fetchSessionCommitsToPush(session);
      if (commitsToPush > 0 || hasDraftPr) {
        setUnpushedCount(commitsToPush);
        setShowConfirm(true);
        return;
      }
      await performArchive();
    } catch (err) {
      toastError('Failed to check git status', err);
    } finally {
      setChecking(false);
    }
  };

  const title =
    archiving || isArchiving
      ? 'Archiving…'
      : checking
        ? 'Checking for unpushed commits…'
        : 'Archive session';

  return (
    <>
      <button
        onClick={handleClick}
        disabled={blocked}
        title={title}
        className="p-1 text-faint hover:text-accent hover:bg-control rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {archiving || checking || session.status === 'archiving' ? (
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
        ) : (
          <Archive className="w-3.5 h-3.5 shrink-0" />
        )}
      </button>

      {showConfirm && (
        <ArchiveConfirmModal
          prNumber={hasDraftPr ? session.pr_number : null}
          commitsToPush={unpushedCount}
          loading={archiving}
          onConfirm={performArchive}
          onCancel={() => {
            if (archiving) return;
            setShowConfirm(false);
          }}
        />
      )}
    </>
  );
}
