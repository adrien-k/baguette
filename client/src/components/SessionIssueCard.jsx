import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { ISSUE_SEVERITIES } from '@baguette/shared/session-issues.js';
import { NEUTRAL_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../utils/buttonStyles.js';
import MarkdownContent from './MarkdownContent.jsx';
import { issueAgentSubtitle } from '../utils/messageModelLabel.js';
import ComposerTextarea from './ComposerTextarea.jsx';

const SEVERITY_CLASS = {
  critical: 'bg-danger/15 text-danger border-danger/35',
  high: 'bg-warning/15 text-warning border-warning/35',
  medium: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/35',
  low: 'bg-control/80 text-fg-muted border-strong/80',
};

const ISSUE_META_CHIP =
  'inline-flex items-center justify-center h-7 shrink-0 rounded-md border text-xs capitalize';

const FIELD_CLASS =
  'w-full rounded-md border border-strong bg-control px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/50';

function descriptionStartsOpen(status) {
  return status === 'opened' || status === 'needs_decision';
}

function issueOptions(issue) {
  const raw = issue?.options;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function selectedOptionTitle(issue, options) {
  if (!issue?.selected_option_id) return '';
  const match = options.find((opt) => opt?.id === issue.selected_option_id);
  return match?.title ?? '';
}

function statusChipLabel(status) {
  if (status === 'needs_decision') return 'needs decision';
  return status;
}

function statusChipClass(status) {
  if (status === 'needs_decision') {
    return `${ISSUE_META_CHIP} border-brand/40 bg-brand/10 text-accent px-2`;
  }
  return `${ISSUE_META_CHIP} border-strong text-faint px-2`;
}

function optionRowClass(selected) {
  if (selected) return 'border-brand/50 bg-brand/10';
  return 'border-line bg-inset/40';
}

function IssueOptionRows({ options, selectedId, interactive, disabled, onSelect }) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const selected = opt.id === selectedId;
        const className = `w-full rounded-md border px-3 py-2 text-left ${optionRowClass(selected)}`;
        const body = (
          <>
            <span className="block text-sm font-medium text-fg">{opt.title}</span>
            {opt.description ? (
              <span className="mt-0.5 block text-xs text-fg-muted leading-relaxed">
                {opt.description}
              </span>
            ) : null}
          </>
        );
        if (!interactive) {
          return (
            <div key={opt.id} className={className}>
              {body}
            </div>
          );
        }
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt.id)}
            className={`${className} disabled:opacity-50 disabled:cursor-not-allowed hover:border-brand/40`}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

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
  readonly,
  saving,
  onStatusChange,
  onDelete,
  onFix,
  onSave,
  onSelectOption,
  selectingOption = false,
}) {
  const [editing, setEditing] = useState(false);
  const [descOpen, setDescOpen] = useState(descriptionStartsOpen(issue.status));
  const [draftTitle, setDraftTitle] = useState(issue.title);
  const [draftSeverity, setDraftSeverity] = useState(issue.severity);
  const [draftDescription, setDraftDescription] = useState(issue.description ?? '');

  useEffect(() => {
    setDescOpen(descriptionStartsOpen(issue.status));
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

  const canSaveIssue = Boolean(draftTitle.trim());

  const needsDecision = issue.status === 'needs_decision';
  const active = issue.status === 'opened' || needsDecision;
  const canEdit = !readonly && issue.status === 'opened';
  const options = issueOptions(issue);
  const decisionTitle = selectedOptionTitle(issue, options);
  const showStatusChip = readonly || issue.status === 'resolved' || needsDecision;
  const agentSubtitle = issueAgentSubtitle({
    agent_sdk: issue.agent_sdk,
    model: issue.model,
    model_params: issue.model_params,
  });

  return (
    <div
      id={`issue-${issue.ref}`}
      className={`rounded-lg border p-4 space-y-3 scroll-mt-4 ${
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
            <ComposerTextarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              onSubmit={() => {
                void handleSave();
              }}
              canSubmit={canSaveIssue}
              disabled={saving}
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
              <h3 className="text-base font-semibold text-fg leading-snug">
                <span className="text-faint font-mono text-sm mr-1.5">#{issue.ref}</span>
                {issue.title}
              </h3>
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
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(issue)}
                    title="Delete issue"
                    className="p-1.5 rounded-md text-faint hover:text-danger hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`${ISSUE_META_CHIP} text-[10px] uppercase tracking-wide px-2 border ${SEVERITY_CLASS[issue.severity] || SEVERITY_CLASS.low}`}
            >
              {issue.severity}
            </span>
            {showStatusChip ? (
              <span className={statusChipClass(issue.status)}>{statusChipLabel(issue.status)}</span>
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
          {needsDecision && options.length > 0 && (
            <IssueOptionRows
              options={options}
              selectedId={issue.selected_option_id}
              interactive={!readonly && Boolean(onSelectOption)}
              disabled={selectingOption}
              onSelect={(optionId) => onSelectOption(issue, optionId)}
            />
          )}
          {!needsDecision && readonly && options.length > 0 && (
            <IssueOptionRows
              options={options}
              selectedId={issue.selected_option_id}
              interactive={false}
            />
          )}
          {!needsDecision && decisionTitle ? (
            <p className="text-xs text-fg-muted">Decision: {decisionTitle}</p>
          ) : null}
          {!readonly && issue.status === 'opened' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onFix(issue)} className={SECONDARY_BUTTON_CLASS}>
                Ask agent to fix
              </button>
              <button
                type="button"
                onClick={() => onStatusChange(issue.id, 'ignored')}
                className={NEUTRAL_BUTTON_CLASS}
              >
                Ignore
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
