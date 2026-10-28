import { useEffect, useRef, useState } from 'react';
import { Archive, Check, Loader2, X } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { fetchSessionCommitsToPush } from '../utils/sessionCommitsToPush.js';
import ArchiveConfirmModal from './ArchiveConfirmModal.jsx';

export default function ArchiveSession({ session, onArchive }) {
  const [archiving, setArchiving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [unpushedCount, setUnpushedCount] = useState(0);
  const confirmRef = useRef(null);

  const isProvisioning = session.status === 'provisioning';
  const isArchiving = session.status === 'archiving';
  const blocked = archiving || isArchiving;
  const hasDraftPr = session.pr_status === 'draft' && session.pr_number;

  const performArchive = async ({ closePr = false } = {}) => {
    setArchiving(true);
    try {
      const query = closePr ? { close_pr: true } : {};
      await sessionsService.archive(session.id, { query });
      setPendingConfirm(false);
      setShowConfirmModal(false);
      onArchive?.();
    } catch (err) {
      toastError('Failed to archive session', err);
      setArchiving(false);
    }
  };

  const startConfirm = (e) => {
    e.stopPropagation();
    if (blocked || pendingConfirm) return;
    setPendingConfirm(true);
  };

  const dismissConfirm = () => {
    if (archiving) return;
    setPendingConfirm(false);
    setUnpushedCount(0);
  };

  useEffect(() => {
    if (!pendingConfirm || archiving) return;
    const handler = (e) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target)) {
        setPendingConfirm(false);
        setUnpushedCount(0);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pendingConfirm, archiving]);

  const handleCancel = (e) => {
    e.stopPropagation();
    dismissConfirm();
  };

  const handleConfirm = async (e) => {
    e.stopPropagation();
    if (blocked || checking) return;

    setChecking(true);
    try {
      const commitsToPush = await fetchSessionCommitsToPush(session);
      setUnpushedCount(commitsToPush);
      if (commitsToPush > 0 || hasDraftPr) {
        setPendingConfirm(false);
        setShowConfirmModal(true);
        setChecking(false);
        return;
      }
    } catch (err) {
      toastError('Failed to check git status', err);
      setChecking(false);
      return;
    }
    setChecking(false);
    await performArchive();
  };

  const confirmTitle = (() => {
    if (checking) return 'Checking for unpushed commits…';
    if (archiving || isArchiving) return 'Archiving…';
    const parts = ['Confirm archive'];
    if (unpushedCount > 0) {
      parts.push(
        `${unpushedCount} unpushed commit${unpushedCount === 1 ? '' : 's'} will stay local only`
      );
    }
    return parts.join(' · ');
  })();

  const iconButtonClass =
    'p-1 text-faint hover:text-accent hover:bg-control rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  const archiveButton = pendingConfirm ? (
    <div
      ref={confirmRef}
      className="flex items-center gap-0.5 shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-medium text-faint whitespace-nowrap pr-0.5">Archive?</span>
      <button
        type="button"
        onClick={handleCancel}
        disabled={archiving}
        title="Cancel"
        className={`${iconButtonClass} hover:text-secondary`}
      >
        <X className="w-3.5 h-3.5 shrink-0" />
      </button>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={blocked || checking}
        title={confirmTitle}
        className={`${iconButtonClass} hover:text-success`}
      >
        {archiving || checking ? (
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
        ) : (
          <Check className="w-3.5 h-3.5 shrink-0" />
        )}
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={startConfirm}
      disabled={blocked}
      title={isProvisioning ? 'Archive provisioning session' : 'Archive session'}
      className={iconButtonClass}
    >
      {archiving || isArchiving ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
      ) : (
        <Archive className="w-3.5 h-3.5 shrink-0" />
      )}
    </button>
  );

  return (
    <>
      {archiveButton}
      {showConfirmModal && (
        <ArchiveConfirmModal
          prNumber={hasDraftPr ? session.pr_number : null}
          commitsToPush={unpushedCount}
          loading={archiving}
          onConfirm={performArchive}
          onCancel={() => {
            if (archiving) return;
            setShowConfirmModal(false);
            setUnpushedCount(0);
          }}
        />
      )}
    </>
  );
}
