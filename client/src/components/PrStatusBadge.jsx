import { GitPullRequest, GitPullRequestDraft, GitMerge, GitPullRequestClosed } from 'lucide-react';

const STATUS_CONFIG = {
  open: {
    icon: GitPullRequest,
    className:
      'text-emerald-400 border-emerald-800/80 bg-emerald-950/40 hover:border-emerald-600/60 hover:bg-emerald-950/55',
    title: 'Open pull request',
  },
  draft: {
    icon: GitPullRequestDraft,
    className:
      'text-zinc-400 border-zinc-700/80 bg-zinc-800/40 hover:border-zinc-600 hover:bg-zinc-800/60',
    title: 'Draft pull request',
  },
  merged: {
    icon: GitMerge,
    className:
      'text-indigo-400 border-indigo-800/80 bg-indigo-950/40 hover:border-indigo-600/60 hover:bg-indigo-950/55',
    title: 'Merged pull request',
  },
  closed: {
    icon: GitPullRequestClosed,
    className:
      'text-red-400 border-red-800/80 bg-red-950/40 hover:border-red-600/60 hover:bg-red-950/55',
    title: 'Closed pull request',
  },
};

const FALLBACK = STATUS_CONFIG.open;

const BASE_CLASS =
  'session-tool-btn inline-flex items-center justify-center shrink-0 rounded-md border font-medium transition-colors h-8 gap-1.5 px-2 text-xs';

export default function PrStatusBadge({
  status,
  prNumber,
  prUrl,
  hideLabelBelowSm = false,
  onClick,
}) {
  if (!prUrl && prNumber == null) return null;

  const config = STATUS_CONFIG[status] ?? FALLBACK;
  const { icon: Icon, className, title: titleBase } = config;
  const title = prNumber != null ? `${titleBase} #${prNumber}` : titleBase;
  const classNames = `${BASE_CLASS} ${className}`;

  const content = (
    <>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      {prNumber != null && (
        <span className={hideLabelBelowSm ? 'hidden sm:inline' : undefined}>#{prNumber}</span>
      )}
    </>
  );

  if (prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={classNames}
        title={title}
        onClick={onClick ?? ((e) => e.stopPropagation())}
      >
        {content}
      </a>
    );
  }

  return (
    <span className={classNames} title={title}>
      {content}
    </span>
  );
}
