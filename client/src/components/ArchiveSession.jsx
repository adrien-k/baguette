import { useState } from 'react';
import { Archive, Loader2 } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import ArchiveUnpushedWarningModal from './ArchiveUnpushedWarningModal.jsx';

export default function ArchiveSession({ session, onArchive }) {
  const [archiving, setArchiving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showUnpushedWarning, setShowUnpushedWarning] = useState(false);
  const [unpushedCount, setUnpushedCount] = useState(0);

  const isProvisioning = session.status === 'provisioning';
  const isArchiving = session.status === 'archiving';
  const blocked = archiving || checking || isArchiving || isProvisioning;

  const performArchive = async () => {
    setArchiving(true);
    try {
      await sessionsService.remove(session.id);
      setShowUnpushedWarning(false);
      onArchive?.();
    } catch (err) {
      toastError('Failed to archive session', err);
      setArchiving(false);
    }
  };

  const resolveCommitsToPush = async () => {
    if (isGlobalSession(session)) return 0;
    const status = await sessionsService.sessionGitStatus(session.id);
    return status.commitsToPush ?? 0;
  };

  const handleClick = async (e) => {
    e.stopPropagation();
    if (blocked) return;

    setChecking(true);
    try {
      const commitsToPush = await resolveCommitsToPush();
      if (commitsToPush > 0) {
        setUnpushedCount(commitsToPush);
        setShowUnpushedWarning(true);
        return;
      }
      await performArchive();
    } catch (err) {
      toastError('Failed to check git status', err);
    } finally {
      setChecking(false);
    }
  };

  const title = isProvisioning
    ? 'Session is still being set up'
    : archiving || isArchiving
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
        className="p-1 text-zinc-500 hover:text-amber-500 hover:bg-zinc-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {archiving || checking || session.status === 'archiving' ? (
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
        ) : (
          <Archive className="w-3.5 h-3.5 shrink-0" />
        )}
      </button>

      {showUnpushedWarning && (
        <ArchiveUnpushedWarningModal
          commitsToPush={unpushedCount}
          loading={archiving}
          onConfirm={performArchive}
          onCancel={() => {
            if (archiving) return;
            setShowUnpushedWarning(false);
          }}
        />
      )}
    </>
  );
}
