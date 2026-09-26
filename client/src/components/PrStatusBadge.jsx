import { GitPullRequest, GitPullRequestDraft, GitMerge, GitPullRequestClosed } from 'lucide-react';

const BADGE_SURFACE = 'border-zinc-700 bg-zinc-800/40';

const STATUS_CONFIG = {
  open: {
    icon: GitPullRequest,
    className: `text-emerald-400 ${BADGE_SURFACE}`,
  },
  draft: { icon: GitPullRequestDraft, className: `text-zinc-400 ${BADGE_SURFACE}` },
  merged: { icon: GitMerge, className: `text-indigo-400 ${BADGE_SURFACE}` },
  closed: { icon: GitPullRequestClosed, className: `text-red-400 ${BADGE_SURFACE}` },
};

const FALLBACK = STATUS_CONFIG.open;

export default function PrStatusBadge({ status, prNumber, prUrl }) {
  if (!status && !prNumber) return null;

  const { icon: Icon, className } = STATUS_CONFIG[status] ?? FALLBACK;

  const content = (
    <span
      className={`inline-flex items-center gap-1 text-xs border rounded px-1.5 py-0.5 ${className}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {prNumber && <span>#{prNumber}</span>}
    </span>
  );

  if (prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      >
        {content}
      </a>
    );
  }

  return content;
}
