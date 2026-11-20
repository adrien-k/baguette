import { useState, useEffect } from 'react';
import { AlertTriangle, ArrowUpToLine } from 'lucide-react';
import SearchableSelect from './SearchableSelect/index.jsx';
import { useGetBranches } from '../hooks/useGetBranches.js';
import { sessionsService } from '../feathers.js';
import Toggle from './Toggle.jsx';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS } from '../utils/buttonStyles.js';
import { gitPushApprovalTriggers } from './chat/gitPushCardHelpers.js';
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
  initialSourceBranch = '',
  initialForceMode,
  localBranch = '',
  sessionRemoteBranch = '',
  sessionLocalBranch = '',
  reason = null,
  autoPushOff = false,
  agentRequest = false,
  autoPush,
  autoPushDisabled = false,
  onAutoPushChange,
  hasExistingPr = false,
  onConfirm,
  onCancel,
}) {
  const [forceMode, setForceMode] = useState(initialForceMode || '');
  const [branch, setBranch] = useState(initialBranch || '');
  const effectiveBranch = agentRequest ? initialBranch || '' : branch;
  const effectiveForceMode = agentRequest ? initialForceMode || '' : forceMode;
  const [createPr, setCreatePr] = useState(true);
  const [localSha, setLocalSha] = useState(null);
  const [remoteSha, setRemoteSha] = useState(null);
  const [loadingShas, setLoadingShas] = useState(false);

  let prPhrase = ' and update the PR.';
  if (agentRequest) {
    // Agent-initiated approval (GitPush tool): no PR create or sync.
    prPhrase = '';
  } else if (!hasExistingPr) {
    prPhrase = createPr ? ' and create the PR.' : '';
  }

  const { branches, loading: loadingBranches } = useGetBranches(agentRequest ? null : repo);

  const isPureForce = effectiveForceMode === 'force';
  let forceModeLabel = 'Normal push';
  if (effectiveForceMode === 'force') forceModeLabel = 'Force (--force)';
  else if (effectiveForceMode === 'lease') forceModeLabel = 'Force with lease (--force-with-lease)';
  const approvalTriggers = agentRequest
    ? gitPushApprovalTriggers({
        forceMode: initialForceMode || null,
        targetBranch: initialBranch || null,
        sourceBranch: initialSourceBranch || null,
        sessionRemoteBranch: sessionRemoteBranch || localBranch || null,
        sessionLocalBranch: sessionLocalBranch || localBranch || null,
        autoPushOff,
      })
    : [];

  useEffect(() => {
    if (!sessionId || !effectiveBranch) {
      setLocalSha(null);
      setRemoteSha(null);
      return;
    }
    let cancelled = false;
    setLoadingShas(true);
    sessionsService
      .shas({
        id: sessionId,
        branch: effectiveBranch,
        ...(initialSourceBranch ? { source_branch: initialSourceBranch } : {}),
      })
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
  }, [sessionId, effectiveBranch, initialSourceBranch]);

  const confirmPush = () =>
    onConfirm({
      forceMode: agentRequest ? initialForceMode || null : forceMode || null,
      branch: agentRequest ? initialBranch || null : branch || null,
      sourceBranch: initialSourceBranch || null,
      createPr: agentRequest ? false : createPr,
      syncPr: !agentRequest,
    });

  return (
    <Modal>
      <ModalHeader
        title={agentRequest ? 'Agent wants to push' : 'Push commits'}
        onClose={agentRequest ? null : onCancel}
      />

      {agentRequest ? (
        <p className={`${TEXT_MUTED} text-sm mb-3 leading-snug`}>
          The agent requested a push to origin. Review the details below and accept or reject.
        </p>
      ) : null}

      {agentRequest && approvalTriggers.length > 0 ? (
        <div
          className={`mb-3 rounded-lg border border-warning/40 ${TINT_WARN_SOFT} px-3 py-2.5 space-y-2`}
        >
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${TEXT_MUTED}`}>
            Why confirmation is required
          </p>
          <ul className="space-y-2">
            {approvalTriggers.map((trigger) => (
              <li key={trigger.key} className="flex items-start gap-2 text-xs leading-snug">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warning" />
                <div className="min-w-0">
                  <p className={`font-medium ${TEXT_HEADING}`}>{trigger.title}</p>
                  <p className={TEXT_MUTED}>{trigger.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reason ? (
        <div
          className={`mb-2 rounded-lg border ${HAIRLINE} bg-control/40 px-3 py-2 text-xs ${TEXT_MUTED}`}
        >
          <span className={`${TEXT_FAINT} uppercase tracking-wide text-[10px] mr-1.5`}>Agent</span>
          <span className={TEXT_HEADING}>{reason}</span>
        </div>
      ) : null}

      <p className={`${TEXT_MUTED} text-sm mb-1`}>
        Push{' '}
        {commitsToPush > 0 ? (
          <span className={`${TEXT_ACCENT} font-medium`}>
            {commitsToPush} commit{commitsToPush !== 1 ? 's' : ''}
          </span>
        ) : (
          'changes'
        )}{' '}
        to origin{prPhrase}
      </p>

      <div className="flex flex-col gap-3 mb-0 mt-4">
        <div>
          <label className={`block text-xs ${TEXT_MUTED} mb-1`}>Branch</label>
          {agentRequest ? (
            <p className={`text-sm font-mono ${TEXT_HEADING} break-all`}>
              origin/{effectiveBranch}
            </p>
          ) : (
            <SearchableSelect
              value={branch}
              onChange={setBranch}
              options={branches}
              loading={loadingBranches}
              placeholder="Search branches..."
              loadingText="Loading branches..."
              emptyText="No branches found"
            />
          )}
          {(initialSourceBranch || (localBranch && localBranch !== effectiveBranch)) && (
            <div className={`mt-1.5 font-mono text-[10px] ${TEXT_FAINT}`}>
              {initialSourceBranch
                ? `${initialSourceBranch} → origin/${effectiveBranch}`
                : `local ${localBranch} → origin/${effectiveBranch}`}
            </div>
          )}
          {(localSha || remoteSha) && (
            <div className={`mt-1.5 flex items-center gap-1.5 font-mono text-[10px] ${TEXT_FAINT}`}>
              <span title={initialSourceBranch || 'Local HEAD'}>{localSha ?? '?'}</span>
              <span className="text-faint">/</span>
              <span
                title={`origin/${effectiveBranch}`}
                className={remoteSha && remoteSha !== localSha ? 'text-fg-muted' : 'text-faint'}
              >
                {loadingShas ? '…' : (remoteSha ?? 'no remote')}
              </span>
            </div>
          )}
        </div>

        <div>
          <label className={`block text-xs ${TEXT_MUTED} mb-1`}>Force mode</label>
          {agentRequest ? (
            <p className={`text-sm ${TEXT_HEADING}`}>{forceModeLabel}</p>
          ) : (
            <select
              value={forceMode}
              onChange={(e) => setForceMode(e.target.value)}
              className={`${INPUT_CLASS} py-1.5 text-heading`}
            >
              <option value="">Normal push</option>
              <option value="lease">Force with lease (--force-with-lease)</option>
              <option value="force">Force (--force)</option>
            </select>
          )}
        </div>

        {effectiveForceMode === 'force' && (
          <div className={`flex items-start gap-2 text-xs ${TINT_WARN_SOFT} rounded-lg px-3 py-2`}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              <strong>--force</strong> overwrites remote history. Only use if you know what
              you&apos;re doing.
            </span>
          </div>
        )}
        {effectiveForceMode === 'lease' && (
          <div className={`flex items-start gap-2 text-xs ${TINT_WARN_SOFT} rounded-lg px-3 py-2`}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              <strong>--force-with-lease</strong> overwrites the remote branch unless it moved since
              your last fetch.
            </span>
          </div>
        )}
        {autoPushOff && !autoPush && !agentRequest && (
          <div className={`flex items-start gap-2 text-xs ${TINT_WARN_SOFT} rounded-lg px-3 py-2`}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Auto-push is off for this session. Confirming pushes this once manually — re-enable
              auto-push below if it should be automatic again.
            </span>
          </div>
        )}

        {!hasExistingPr && !agentRequest && (
          <label
            className={`flex items-center justify-between gap-3 rounded-lg border ${HAIRLINE} bg-control/40 px-3 py-2.5 cursor-pointer`}
          >
            <div className="min-w-0">
              <p className={`text-sm ${TEXT_HEADING}`}>Create PR if it does not exist</p>
              <p className={`text-xs ${TEXT_FAINT} leading-snug`}>
                Opens a draft pull request for the pushed branch
              </p>
            </div>
            <input
              type="checkbox"
              checked={createPr}
              onChange={(e) => setCreatePr(e.target.checked)}
              className="w-4 h-4 shrink-0 rounded border-strong bg-control text-ok focus:ring-ok/50"
            />
          </label>
        )}

        {onAutoPushChange && !agentRequest && (
          <div
            className={`flex items-center justify-between gap-3 rounded-lg border ${HAIRLINE} bg-control/40 px-3 py-2.5`}
          >
            <div className="min-w-0">
              <p className={`text-sm ${TEXT_HEADING}`}>Auto-push</p>
              <p className={`text-xs ${TEXT_FAINT} leading-snug`}>
                {autoPushDisabled
                  ? 'Not available for local repositories'
                  : 'Automatically push after the agent commits'}
              </p>
            </div>
            <Toggle
              checked={!!autoPush}
              disabled={autoPushDisabled}
              onChange={onAutoPushChange}
              title={
                autoPushDisabled
                  ? 'Auto-push is not available for local repositories'
                  : 'Automatically push after the agent commits'
              }
            />
          </div>
        )}
      </div>

      <ModalActions className="flex gap-3 mt-6">
        {agentRequest ? (
          <>
            <button type="button" onClick={onCancel} className={`flex-1 ${GHOST_BUTTON_CLASS}`}>
              Reject
            </button>
            <button
              type="button"
              onClick={confirmPush}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                isPureForce
                  ? 'bg-err hover:bg-err-hover text-on-solid'
                  : 'bg-brand hover:bg-brand-hover text-on-brand'
              }`}
            >
              <ArrowUpToLine className="w-3.5 h-3.5" />
              Accept
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onCancel} className={`flex-1 ${GHOST_BUTTON_CLASS}`}>
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmPush}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                isPureForce
                  ? 'bg-err hover:bg-err-hover text-on-solid'
                  : 'bg-brand hover:bg-brand-hover text-on-brand'
              }`}
            >
              <ArrowUpToLine className="w-3.5 h-3.5" />
              {isPureForce ? 'Force Push' : forceMode === 'lease' ? 'Force Push' : 'Push'}
            </button>
          </>
        )}
      </ModalActions>
    </Modal>
  );
}
