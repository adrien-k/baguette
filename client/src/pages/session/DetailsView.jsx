import { useEffect, useState } from 'react';
import { Copy, GitBranch, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import CardRepoBadge from '../../components/CardRepoBadge.jsx';
import CollapsibleMarkdown from '../../components/chat/CollapsibleMarkdown.jsx';
import TextInput from '../../components/TextInput.jsx';
import PrStatusBadge from '../../components/PrStatusBadge.jsx';
import { SESSION_CONTENT_MAX_WIDTH_CLASS } from '../../components/ChatMessagesViewport.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { CARD_MUTED_CLASS, TEXT_HEADING, TEXT_PRIMARY } from '../../utils/ui.js';
import { formatTokens, formatUsd, KIND_LABELS, SDK_LABELS } from '../../utils/usageSeries.js';

const SECTION_HEADING_CLASS = 'text-xs font-medium uppercase tracking-wide text-faint';

function DetailsCard({ label, children }) {
  return (
    <div className={`${CARD_MUTED_CLASS} p-4 sm:p-6 space-y-3`}>
      <h2 className={SECTION_HEADING_CLASS}>{label}</h2>
      {children}
    </div>
  );
}

function GitBranchRow({ label, value, emptyMessage }) {
  const branch = value?.trim() || '';
  const display = branch || emptyMessage || '—';
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-snug">
      <span className="w-[4.25rem] shrink-0 text-faint">{label}</span>
      <GitBranch className="w-3 h-3 shrink-0 text-faint" aria-hidden />
      <span
        className={`min-w-0 flex-1 truncate ${
          branch ? 'font-mono text-secondary' : 'text-faint italic'
        }`}
        title={branch || undefined}
      >
        {display}
      </span>
      {branch ? (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(branch);
            toast.success(`${label} branch copied`);
          }}
          className="shrink-0 rounded p-1 text-faint hover:text-fg-muted hover:bg-control transition-colors"
          title={`Copy ${label.toLowerCase()} branch`}
          aria-label={`Copy ${label.toLowerCase()} branch`}
        >
          <Copy className="w-3 h-3" />
        </button>
      ) : (
        <span className="w-[1.625rem] shrink-0" aria-hidden />
      )}
    </div>
  );
}

export default function DetailsView({ session, readonly, onSessionUpdate }) {
  const defaultTitle =
    session?.label || (isGlobalSession(session) ? 'Global session' : session?.repo_full_name) || '';
  const displayTitle = session?.label?.trim() || defaultTitle;

  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(session?.label ?? '');
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    setTitle(session?.label ?? '');
    setEditingTitle(false);
  }, [session?.id, session?.label]);

  useEffect(() => {
    if (!session?.id) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    sessionsService
      .sessionUsage(session.id)
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsage(null);
          toastError('Failed to load session usage', err);
        }
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.id]);

  const titleDirty = title.trim() !== (session?.label ?? '').trim();

  const handleSaveTitle = async () => {
    if (!session?.id || readonly || !titleDirty) {
      setEditingTitle(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await sessionsService.patch(session.id, {
        label: title.trim() || null,
      });
      onSessionUpdate?.(updated);
      setEditingTitle(false);
    } catch (err) {
      toastError('Failed to update session title', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setTitle(session?.label ?? '');
    setEditingTitle(false);
  };

  const prDescription = session?.pr_description?.trim();
  const hasPr = !!(session?.pr_url || session?.pr_number != null);
  const showCost = usage?.breakdown?.some((row) => row.cost_usd > 0);

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-page p-4 sm:p-6">
      <div className={`${SESSION_CONTENT_MAX_WIDTH_CLASS} space-y-4`}>
        <DetailsCard label="Description">
          <div className="space-y-3">
            {editingTitle && !readonly ? (
              <div className="space-y-2">
                <TextInput
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveTitle();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelEdit();
                    }
                  }}
                  disabled={saving}
                  placeholder={defaultTitle}
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveTitle}
                    disabled={saving || !titleDirty}
                    className={PRIMARY_BUTTON_SIZED}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className={GHOST_BUTTON_CLASS}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 min-w-0">
                <h1 className={`text-xl font-semibold ${TEXT_HEADING} min-w-0 break-words`}>
                  {displayTitle}
                </h1>
                {!readonly && (
                  <button
                    type="button"
                    onClick={() => setEditingTitle(true)}
                    className="shrink-0 p-1.5 rounded-md text-faint hover:text-secondary hover:bg-control transition-colors"
                    aria-label="Edit session title"
                    title="Edit title"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={`text-sm ${TEXT_PRIMARY} min-w-0`}>
            {prDescription ? (
              <CollapsibleMarkdown previewLines={12} simpleToggle>
                {prDescription}
              </CollapsibleMarkdown>
            ) : (
              <p className="text-faint">No description yet.</p>
            )}
          </div>
        </DetailsCard>

        <DetailsCard label="Git">
          <CardRepoBadge
            show
            nowrap
            isGlobal={isGlobalSession(session)}
            repoFullName={session?.repo_full_name}
          />
          {isGlobalSession(session) ? (
            <p className="text-sm text-faint">No repository branches for global sessions.</p>
          ) : (
            <>
              <div className="space-y-2 pt-1">
                <GitBranchRow label="Base" value={session?.base_branch} />
                <GitBranchRow
                  label="Remote"
                  value={session?.remote_branch}
                  emptyMessage="No remote branch"
                />
                <GitBranchRow label="Local" value={session?.local_branch} />
              </div>
              <div className="border-t border-line/60 pt-3">
                {hasPr ? (
                  <PrStatusBadge
                    status={session.pr_status}
                    prNumber={session.pr_number}
                    prUrl={session.pr_url}
                  />
                ) : (
                  <p className="text-[11px] text-faint">No pull request yet.</p>
                )}
              </div>
            </>
          )}
        </DetailsCard>

        <DetailsCard label="Usage">
          {usageLoading ? (
            <p className="text-sm text-faint">Loading usage…</p>
          ) : !usage?.breakdown?.length ? (
            <p className="text-sm text-faint">No token usage recorded yet.</p>
          ) : (
            <>
              <p className="text-sm text-secondary">
                <span className="text-faint">Total:</span> {formatTokens(usage.totals.total_tokens)}{' '}
                tokens
                {showCost && (
                  <>
                    {' '}
                    <span className="text-faint">·</span> {formatUsd(usage.totals.cost_usd)}
                  </>
                )}
              </p>
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="text-faint border-b border-line">
                      <th className="py-1.5 pr-3 font-medium">Type</th>
                      <th className="py-1.5 pr-3 font-medium">Model</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Tokens</th>
                      {showCost && <th className="py-1.5 font-medium text-right">Cost</th>}
                    </tr>
                  </thead>
                  <tbody className="text-secondary">
                    {usage.breakdown.map((row) => (
                      <tr
                        key={`${row.kind}-${row.model}-${row.agent_sdk}`}
                        className="border-b border-line/60"
                      >
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {KIND_LABELS[row.kind] ?? row.kind}
                        </td>
                        <td className="py-2 pr-3 min-w-0">
                          <span
                            className="block truncate max-w-[14rem] sm:max-w-none"
                            title={row.model}
                          >
                            {row.model}
                          </span>
                          <span className="text-faint">
                            {SDK_LABELS[row.agent_sdk] ?? row.agent_sdk}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                          {formatTokens(row.total_tokens)}
                        </td>
                        {showCost && (
                          <td className="py-2 text-right tabular-nums whitespace-nowrap">
                            {row.cost_usd > 0 ? formatUsd(row.cost_usd) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DetailsCard>
      </div>
    </div>
  );
}
