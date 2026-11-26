import { useCallback, useState } from 'react';
import { fetchSessionCommitsToPush } from '../utils/sessionCommitsToPush.js';
import { toastError } from '../utils/toastError.jsx';
import { isLocalRepo } from '../utils/repoDisplayName.js';

/**
 * Gate opening the merge PR flow: warn when HEAD is ahead of the session remote branch.
 */
export function useMergePrEntry(session) {
  const [checkingUnpushed, setCheckingUnpushed] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [unpushedCount, setUnpushedCount] = useState(0);

  const openMergeFlow = useCallback(async () => {
    if (!session?.id) return;
    if (isLocalRepo(session.repo_full_name)) {
      setUnpushedCount(0);
      setShowMergeModal(true);
      return;
    }
    setCheckingUnpushed(true);
    try {
      const commitsToPush = await fetchSessionCommitsToPush(session);
      setUnpushedCount(commitsToPush);
      setShowMergeModal(true);
    } catch (err) {
      toastError('Failed to check git status', err);
    } finally {
      setCheckingUnpushed(false);
    }
  }, [session]);

  const closeMergeModal = useCallback(() => {
    setShowMergeModal(false);
  }, []);

  return {
    checkingUnpushed,
    showMergeModal,
    setShowMergeModal,
    unpushedCount,
    openMergeFlow,
    closeMergeModal,
  };
}
