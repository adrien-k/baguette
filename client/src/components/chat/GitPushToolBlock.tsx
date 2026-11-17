import { AlertTriangle, ArrowUpToLine } from 'lucide-react';
import { useGetSession } from '../../hooks/useGetSession.js';
import { parseMcpJsonResult } from '../../utils/parseMcpJsonResult.ts';
import { gitPushNeedsApproval, resolveGitPushBranches } from './gitPushCardHelpers.js';
import { useGitPushApprovalOutcome } from './useGitPushApprovalOutcome.js';

const FORCE_LABEL: Record<string, string> = {
  lease: '--force-with-lease',
  force: '--force',
};

function ForceBadge({ force }: { force: 'lease' | 'force' | null }) {
  if (force === 'lease') {
    return (
      <span className="shrink-0 text-warning text-xs font-medium bg-warning/15 border border-warning/35 px-1.5 py-0.5 rounded">
        {FORCE_LABEL.lease}
      </span>
    );
  }
  if (force === 'force') {
    return (
      <span className="shrink-0 text-danger text-xs font-medium bg-danger/15 border border-danger/35 px-1.5 py-0.5 rounded">
        {FORCE_LABEL.force}
      </span>
    );
  }
  return (
    <span className="shrink-0 text-faint text-xs font-medium bg-control border border-strong px-1.5 py-0.5 rounded">
      Normal push
    </span>
  );
}

function forceFromUnknown(value: unknown): 'lease' | 'force' | null {
  if (value === 'lease' || value === 'force') return value;
  return null;
}

/**
 * Card for the `GitPush` tool: what is pushed where, the requested force
 * option, the agent's reason, and the approval / push state.
 */
export default function GitPushToolBlock({
  args,
  result,
  isError,
  sessionId = null,
}: {
  args: Record<string, unknown>;
  result?: unknown;
  isError: boolean;
  sessionId?: number | string | null;
}) {
  const mcpResult = parseMcpJsonResult(result);
  const { session } = useGetSession(sessionId);
  const persistedOutcome =
    typeof mcpResult?.approval_outcome === 'string' ? mcpResult.approval_outcome : null;
  const requestId = typeof mcpResult?.request_id === 'string' ? mcpResult.request_id : null;
  const approvalRequested = mcpResult?.approval_requested === true && persistedOutcome == null;
  const { outcome: liveOutcome, failureMessage: liveFailureMessage } = useGitPushApprovalOutcome(
    sessionId,
    approvalRequested,
    requestId
  );
  const outcome = persistedOutcome ?? liveOutcome;
  const failureMessage =
    persistedOutcome === 'failed' && typeof mcpResult?.error === 'string'
      ? mcpResult.error
      : liveFailureMessage;

  const running = result == null;
  const needsApproval =
    approvalRequested || (running && gitPushNeedsApproval(args, session ?? undefined));
  const directPushInProgress = running && !needsApproval;
  const approvalPushInProgress = outcome === 'pushing';
  const showPushSpinner = directPushInProgress || approvalPushInProgress;

  const failed = mcpResult?.ok === false || outcome === 'failed' || isError;
  const canceled = outcome === 'canceled';
  const requested =
    approvalRequested &&
    outcome !== 'pushed' &&
    outcome !== 'canceled' &&
    outcome !== 'failed' &&
    outcome !== 'pushing';
  const pushed =
    outcome === 'pushed' ||
    persistedOutcome === 'pushed' ||
    (mcpResult?.ok === true && !approvalRequested && !running && !failed && !isError && !canceled);

  const errorMessage =
    (outcome === 'failed' && failureMessage) ||
    (mcpResult?.ok === false && typeof mcpResult?.error === 'string' ? mcpResult.error : null) ||
    (isError && result != null ? String(result).slice(0, 200) : null);

  const { targetBranch, localBranch } = resolveGitPushBranches(args, mcpResult, session);
  const force =
    mcpResult?.force != null ? forceFromUnknown(mcpResult.force) : forceFromUnknown(args.force);
  const argsReason = typeof args.reason === 'string' && args.reason ? args.reason : null;
  const reason =
    typeof mcpResult?.reason === 'string' && mcpResult.reason ? mcpResult.reason : argsReason;
  const autoPushOff = mcpResult?.auto_push_off === true;

  const showApprovalWait =
    (running && needsApproval && !directPushInProgress) || (requested && outcome !== 'pushing');
  const showDirectPushMessage = directPushInProgress || approvalPushInProgress;

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${
        failed || isError ? 'border-danger/60' : force ? 'border-warning/50' : 'border-info/50'
      }`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 min-w-0">
        <ArrowUpToLine className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-accent text-xs font-mono shrink-0">GitPush</span>
        {(failed || isError) && (
          <span className="shrink-0 text-danger text-xs font-medium bg-soft-danger px-1.5 py-0.5 rounded">
            error
          </span>
        )}
        {canceled && (
          <span className="shrink-0 text-faint text-xs font-medium bg-control border border-strong px-1.5 py-0.5 rounded">
            canceled
          </span>
        )}
        {requested && (
          <span className="shrink-0 text-warning text-xs font-medium bg-warning/15 border border-warning/35 px-1.5 py-0.5 rounded">
            approval requested
          </span>
        )}
        {pushed && (
          <span className="shrink-0 text-faint text-xs font-medium bg-control px-1.5 py-0.5 rounded">
            pushed
          </span>
        )}
        {showPushSpinner && (
          <div className="w-3.5 h-3.5 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        )}
      </div>
      <div className="px-3 sm:px-4 py-3 border-t border-line text-xs space-y-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0 font-mono">
          {localBranch ? (
            <>
              <span className="text-fg">{localBranch}</span>
              <span className="text-faint">→ origin/</span>
              <span className="text-fg font-semibold truncate">{targetBranch}</span>
            </>
          ) : (
            <>
              <span className="text-faint">origin/</span>
              <span className="text-fg font-semibold truncate">{targetBranch}</span>
            </>
          )}
          <ForceBadge force={force} />
        </div>
        {reason ? (
          <p className="text-fg-muted leading-snug">
            <span className="text-faint uppercase tracking-wide text-[10px] mr-1.5">Agent</span>
            {reason}
          </p>
        ) : null}
        {autoPushOff && (
          <p className="flex items-start gap-1.5 text-warning leading-snug">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            Auto-push is off — the user is asked whether to push once anyway.
          </p>
        )}
        {showApprovalWait && (
          <p className="text-faint leading-snug">
            Waiting for the user to confirm or cancel in the Push modal.
          </p>
        )}
        {showDirectPushMessage && <p className="text-faint leading-snug">Pushing to origin…</p>}
        {errorMessage ? <p className="text-danger leading-snug">{errorMessage}</p> : null}
      </div>
    </div>
  );
}
