import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { ISSUE_SEVERITIES } from '@baguette/shared/session-issues.js';
import { SECONDARY_BUTTON_CLASS } from '../utils/buttonStyles.js';
import AutoGrowTextarea from './AutoGrowTextarea.jsx';
import MarkdownContent from './MarkdownContent.jsx';

const SEVERITY_CLASS = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/35',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/35',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/35',
  low: 'bg-zinc-800/80 text-zinc-400 border-zinc-600/80',
};

const ISSUE_META_CHIP =
  'inline-flex items-center justify-center h-7 shrink-0 rounded-md border text-xs capitalize';

const FIELD_CLASS =
  'w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50';

function IssueDescription({ description }) {
  if (!description?.trim()) {
    return <p className="text-xs text-zinc-600 italic">No description</p>;
  }
  return (
    <div className="text-zinc-400">
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
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(issue.title);
  const [draftSeverity, setDraftSeverity] = useState(issue.severity);
  const [draftDescription, setDraftDescription] = useState(issue.description ?? '');

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

  const active = issue.status === 'opened' || issue.status === 'submitted';

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        active ? 'border-zinc-700 bg-zinc-900/60' : 'border-zinc-800 opacity-70'
      }`}
    >
      {editing ? (
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] text-zinc-500 mb-1 block">Title</span>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-500 mb-1 block">Severity</span>
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
            <span className="text-[11px] text-zinc-500 mb-1 block">Description</span>
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
              className="inline-flex items-center bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 px-3 py-1.5 rounded-lg text-sm font-medium"
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
            <h3 className="flex-1 min-w-0 text-base font-semibold text-zinc-50 leading-snug">
              {issue.title}
            </h3>
            {!readonly && (
              <div className="flex shrink-0 items-center gap-0.5 -mt-0.5">
                <button
                  type="button"
                  onClick={startEdit}
                  title="Edit issue"
                  className="p-1.5 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(issue)}
                  title="Delete issue"
                  className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
              <span className={`${ISSUE_META_CHIP} border-zinc-700 text-zinc-500 px-2`}>
                {issue.status}
              </span>
            ) : (
              <select
                value={issue.status}
                onChange={(e) => onStatusChange(issue.id, e.target.value)}
                className={`${ISSUE_META_CHIP} bg-zinc-800 border-zinc-700 px-2 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50`}
              >
                <option value="opened">opened</option>
                <option value="submitted">submitted</option>
                <option value="ignored">ignored</option>
              </select>
            )}
          </div>
          <IssueDescription description={issue.description} />
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
