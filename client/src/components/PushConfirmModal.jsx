import { useState, useEffect } from 'react';
import { Upload, AlertTriangle } from 'lucide-react';
import SearchableSelect from './SearchableSelect/index.jsx';
import { useGetBranches } from '../hooks/useGetBranches.js';
import { sessionsService } from '../feathers.js';
import Toggle from './Toggle.jsx';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import {
  HAIRLINE,
  INPUT_CLASS,
  TEXT_ACCENT,
  TEXT_FAINT,
  TEXT_HEADING,
  TEXT_MUTED,
  TINT_WARN_SOFT,
} from '../utils/ui.js';

export default function PushConfirmModal({
  sessionId,
  repo,
  commitsToPush,
  initialBranch,
  initialForceMode,
  autoPush,
  onAutoPushChange,
  onConfirm,
  onCancel,
}) {
  const [forceMode, setForceMode] = useState(initialForceMode || '');
  const [branch, setBranch] = useState(initialBranch || '');
  const [localSha, setLocalSha] = useState(null);
  const [remoteSha, setRemoteSha] = useState(null);
  const [loadingShas, setLoadingShas] = useState(false);

  const { branches, loading: loadingBranches } = useGetBranches(repo);

  const isPureForce = forceMode === 'force';

  useEffect(() => {
    if (!sessionId || !branch) {
      setLocalSha(null);
      setRemoteSha(null);
      return;
    }
    let cancelled = false;
    setLoadingShas(true);
    sessionsService
      .shas({ id: sessionId, branch })
      .then((res) => {
        if (cancelled) return;
        setLocalSha(res.localSha ?? null);
        setRemoteSha(res.remoteSha ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setLocalSha(null);
          setRemoteSha(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingShas(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, branch]);

  return (
    <Modal>
      <ModalHeader title="Push commits" onClose={onCancel} />

      <p className={`${TEXT_MUTED} text-sm mb-1`}>
        Push{' '}
        {commitsToPush > 0 ? (
          <span className={`${TEXT_ACCENT} font-medium`}>
            {commitsToPush} commit{commitsToPush !== 1 ? 's' : ''}
          </span>
        ) : (
          'changes'
        )}{' '}
        to GitHub and create/update the PR.
      </p>

      <div className="flex flex-col gap-3 mb-0 mt-4">
        <div>
          <label className={`block text-xs ${TEXT_MUTED} mb-1`}>Branch</label>
          <SearchableSelect
            value={branch}
            onChange={setBranch}
            options={branches}
            loading={loadingBranches}
            placeholder="Search branches..."
            loadingText="Loading branches..."
            emptyText="No branches found"
          />
          {(localSha || remoteSha) && (
            <div className={`mt-1.5 flex items-center gap-1.5 font-mono text-[10px] ${TEXT_FAINT}`}>
              <span title="Local HEAD">{localSha ?? '?'}</span>
              <span className="text-faint">/</span>
              <span
                title={`origin/${branch}`}
                className={remoteSha && remoteSha !== localSha ? 'text-fg-muted' : 'text-faint'}
              >
                {loadingShas ? '…' : (remoteSha ?? 'no remote')}
              </span>
            </div>
          )}
        </div>

        <div>
          <label className={`block text-xs ${TEXT_MUTED} mb-1`}>Force mode</label>
          <select
            value={forceMode}
            onChange={(e) => setForceMode(e.target.value)}
            className={`${INPUT_CLASS} py-1.5 text-heading`}
          >
            <option value="">Normal push</option>
            <option value="lease">Force with lease (--force-with-lease)</option>
            <option value="force">Force (--force)</option>
          </select>
        </div>

        {isPureForce && (
          <div className={`flex items-start gap-2 text-xs ${TINT_WARN_SOFT} rounded-lg px-3 py-2`}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              <strong>--force</strong> overwrites remote history. Only use if you know what
              you&apos;re doing.
            </span>
          </div>
        )}

        {onAutoPushChange && (
          <div
            className={`flex items-center justify-between gap-3 rounded-lg border ${HAIRLINE} bg-control/40 px-3 py-2.5`}
          >
            <div className="min-w-0">
              <p className={`text-sm ${TEXT_HEADING}`}>Auto-push</p>
              <p className={`text-xs ${TEXT_FAINT} leading-snug`}>
                Automatically push after the agent commits
              </p>
            </div>
            <Toggle
              checked={!!autoPush}
              onChange={onAutoPushChange}
              title="Automatically push after the agent commits"
            />
          </div>
        )}
      </div>

      <ModalActions className="flex gap-3 mt-6">
        <button type="button" onClick={onCancel} className={`flex-1 ${GHOST_BUTTON_CLASS}`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm({ forceMode: forceMode || null, branch: branch || null })}
          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            isPureForce
              ? 'bg-err hover:bg-err-hover text-on-solid'
              : 'bg-brand hover:bg-brand-hover text-on-brand'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          {isPureForce ? 'Force Push' : forceMode === 'lease' ? 'Force Push' : 'Push'}
        </button>
      </ModalActions>
    </Modal>
  );
}
