import { useCallback, useState } from 'react';
import { fetchSessionCommitsToPush } from '../utils/sessionCommitsToPush.js';
import { toastError } from '../utils/toastError.jsx';

/**
 * Gate opening the merge PR flow: warn when there are unpushed commits (same check as archive).
 */
export function useMergePrEntry(session) {
  const [checkingUnpushed, setCheckingUnpushed] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [unpushedCount, setUnpushedCount] = useState(0);

  const openMergeFlow = useCallback(async () => {
    if (!session?.id) return;
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
