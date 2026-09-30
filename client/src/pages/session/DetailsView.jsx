import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import MarkdownContent from '../../components/MarkdownContent.jsx';
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

export default function DetailsView({ session, readonly, onSessionUpdate, scrollToSection }) {
  const defaultTitle =
    session?.label || (isGlobalSession(session) ? 'Global session' : session?.repo_full_name) || '';
  const displayTitle = session?.label?.trim() || defaultTitle;

  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(session?.label ?? '');
  const [saving, setSaving] = useState(false);
  const [prTitle, setPrTitle] = useState(null);
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [baguetteYaml, setBaguetteYaml] = useState(null);
  const [baguetteYamlMissing, setBaguetteYamlMissing] = useState(false);
  const [baguetteYamlLoading, setBaguetteYamlLoading] = useState(false);
  const baguetteConfigRef = useRef(null);

  useEffect(() => {
    setTitle(session?.label ?? '');
    setEditingTitle(false);
  }, [session?.id, session?.label]);

  useEffect(() => {
    if (!session?.pr_number) {
      setPrTitle(null);
      return;
    }
    let cancelled = false;
    sessionsService
      .getPrDetails(session.id)
      .then((details) => {
        if (!cancelled) setPrTitle(details.title?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setPrTitle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.id, session?.pr_number]);

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

  useEffect(() => {
    if (!session?.id || isGlobalSession(session)) {
      setBaguetteYaml(null);
      setBaguetteYamlMissing(false);
      return;
    }
    let cancelled = false;
    setBaguetteYamlLoading(true);
    sessionsService
      .baguetteYaml(session.id)
      .then((data) => {
        if (cancelled) return;
        setBaguetteYaml(data.yaml ?? null);
        setBaguetteYamlMissing(!!data.missing);
      })
      .catch((err) => {
        if (!cancelled) {
          setBaguetteYaml(null);
          setBaguetteYamlMissing(false);
          toastError('Failed to load .baguette.yaml', err);
        }
      })
      .finally(() => {
        if (!cancelled) setBaguetteYamlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.id, session?.repo_full_name]);

  useEffect(() => {
    if (scrollToSection !== 'baguette-config' || baguetteYamlLoading) return;
    const el = baguetteConfigRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollToSection, baguetteYamlLoading, baguetteYaml, baguetteYamlMissing]);

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
  const branchLine =
    session?.base_branch && (session?.remote_branch || session?.local_branch)
      ? `${session.base_branch} ← ${session.remote_branch || session.local_branch}`
      : null;
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
              <MarkdownContent>{prDescription}</MarkdownContent>
            ) : (
              <p className="text-faint">No description yet.</p>
            )}
          </div>
        </DetailsCard>

        {hasPr && (
          <DetailsCard label="Pull request">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <PrStatusBadge
                status={session.pr_status}
                prNumber={session.pr_number}
                prUrl={session.pr_url}
              />
              {branchLine && <span className="text-xs text-faint font-mono">{branchLine}</span>}
            </div>
            {prTitle && <p className="text-sm text-secondary">{prTitle}</p>}
            {session.pr_url && (
              <a
                href={session.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:text-accent underline break-all"
              >
                {session.pr_url.replace(/^https?:\/\//, '')}
              </a>
            )}
          </DetailsCard>
        )}

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

        {!isGlobalSession(session) && (
          <div ref={baguetteConfigRef} id="baguette-config" className="scroll-mt-4">
            <DetailsCard label=".baguette.yaml">
              {baguetteYamlLoading ? (
                <p className="text-sm text-faint">Loading config…</p>
              ) : baguetteYamlMissing ? (
                <p className="text-sm text-faint">
                  No <code className="text-secondary">.baguette.yaml</code> in this repository yet.
                </p>
              ) : baguetteYaml ? (
                <pre className="text-xs font-mono text-secondary whitespace-pre-wrap overflow-x-auto leading-5 bg-page/60 border border-line rounded-md p-3 max-h-[min(32rem,60vh)] overflow-y-auto">
                  {baguetteYaml}
                </pre>
              ) : null}
            </DetailsCard>
          </div>
        )}
      </div>
    </div>
  );
}
