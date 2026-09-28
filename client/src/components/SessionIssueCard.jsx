import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { ISSUE_SEVERITIES } from '@baguette/shared/session-issues.js';
import { SECONDARY_BUTTON_CLASS } from '../utils/buttonStyles.js';
import AutoGrowTextarea from './AutoGrowTextarea.jsx';
import MarkdownContent from './MarkdownContent.jsx';
import { issueAgentSubtitle } from '../utils/messageModelLabel.js';

const SEVERITY_CLASS = {
  critical: 'bg-danger/15 text-danger border-danger/35',
  high: 'bg-warning/15 text-warning border-warning/35',
  medium: 'bg-brand/15 text-warning border-brand/35',
  low: 'bg-control/80 text-fg-muted border-strong/80',
};

const ISSUE_META_CHIP =
  'inline-flex items-center justify-center h-7 shrink-0 rounded-md border text-xs capitalize';

const FIELD_CLASS =
  'w-full rounded-md border border-strong bg-control px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/50';

function IssueDescription({ description }) {
  if (!description?.trim()) {
    return <p className="text-xs text-faint italic">No description</p>;
  }
  return (
    <div className="text-fg-muted">
      <MarkdownContent className="!text-xs [&_p]:!text-xs [&_p]:my-1 [&_p]:leading-relaxed">
        {description}
      </MarkdownContent>
    </div>
  );
}

export default function SessionIssueCard({
  issue,
  models = [],
  readonly,
  saving,
  onStatusChange,
  onDelete,
  onFix,
  onSave,
}) {
  const [editing, setEditing] = useState(false);
  const [descOpen, setDescOpen] = useState(issue.status === 'opened');
  const [draftTitle, setDraftTitle] = useState(issue.title);
  const [draftSeverity, setDraftSeverity] = useState(issue.severity);
  const [draftDescription, setDraftDescription] = useState(issue.description ?? '');

  useEffect(() => {
    setDescOpen(issue.status === 'opened');
  }, [issue.id, issue.status]);

  const startEdit = () => {
    setDraftTitle(issue.title);
    setDraftSeverity(issue.severity);
    setDraftDescription(issue.description ?? '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    const title = draftTitle.trim();
    if (!title) return;
    const ok = await onSave(issue.id, {
      title,
      severity: draftSeverity,
      description: draftDescription,
    });
    if (ok) setEditing(false);
  };

  const active = issue.status === 'opened';
  const canEdit = !readonly && issue.status === 'opened';
  const agentSubtitle = issueAgentSubtitle({
    agent_sdk: issue.agent_sdk,
    model: issue.model,
    model_params: issue.model_params,
    models,
  });

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        active ? 'border-strong bg-inset/60' : 'border-line opacity-70'
      }`}
    >
      {editing ? (
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] text-faint mb-1 block">Title</span>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-faint mb-1 block">Severity</span>
            <select
              value={draftSeverity}
              onChange={(e) => setDraftSeverity(e.target.value)}
              className={`${FIELD_CLASS} capitalize`}
            >
              {ISSUE_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-faint mb-1 block">Description</span>
            <AutoGrowTextarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={4}
              maxLines={24}
              className={`${FIELD_CLASS} font-mono text-xs leading-relaxed resize-none`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !draftTitle.trim()}
              className="inline-flex items-center bg-brand hover:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-fg leading-snug">{issue.title}</h3>
              {agentSubtitle ? (
                <p className="mt-0.5 text-xs text-faint font-normal">{agentSubtitle}</p>
              ) : null}
            </div>
            {!readonly && (
              <div className="flex shrink-0 items-center gap-0.5 -mt-0.5">
                {canEdit && (
                  <button
                    type="button"
                    onClick={startEdit}
                    title="Edit issue"
                    className="p-1.5 rounded-md text-faint hover:text-accent hover:bg-brand/10 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(issue)}
                  title="Delete issue"
                  className="p-1.5 rounded-md text-faint hover:text-danger hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`${ISSUE_META_CHIP} text-[10px] uppercase tracking-wide px-2 border ${SEVERITY_CLASS[issue.severity] || SEVERITY_CLASS.low}`}
            >
              {issue.severity}
            </span>
            {readonly || issue.status === 'resolved' ? (
              <span className={`${ISSUE_META_CHIP} border-strong text-faint px-2`}>
                {issue.status}
              </span>
            ) : (
              <select
                value={issue.status}
                onChange={(e) => onStatusChange(issue.id, e.target.value)}
                className={`${ISSUE_META_CHIP} bg-control border-strong px-2 text-heading focus:outline-none focus:ring-2 focus:ring-brand/50`}
              >
                <option value="opened">opened</option>
                <option value="submitted">submitted</option>
                <option value="ignored">ignored</option>
              </select>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => setDescOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-faint hover:text-secondary"
            >
              {descOpen ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
              Description
            </button>
            {descOpen && (
              <div className="mt-2">
                <IssueDescription description={issue.description} />
              </div>
            )}
          </div>
          {!readonly && issue.status === 'opened' && (
            <button type="button" onClick={() => onFix(issue)} className={SECONDARY_BUTTON_CLASS}>
              Ask agent to fix
            </button>
          )}
        </>
      )}
    </div>
  );
}
