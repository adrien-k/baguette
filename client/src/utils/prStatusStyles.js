import { GitPullRequest, GitPullRequestDraft, GitMerge, GitPullRequestClosed } from 'lucide-react';

/** Badge button surfaces (session header / diff bar). */
export const PR_STATUS_BADGE_CONFIG = {
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
      'text-violet-300 border-violet-500/70 bg-violet-500/20 shadow-sm shadow-violet-500/30 ring-1 ring-violet-400/40 hover:border-violet-400 hover:bg-violet-500/30 hover:ring-violet-400/55',
    title: 'Merged pull request',
  },
  closed: {
    icon: GitPullRequestClosed,
    className:
      'text-red-400 border-red-800/80 bg-red-950/40 hover:border-red-600/60 hover:bg-red-950/55',
    title: 'Closed pull request',
  },
};

export const PR_STATUS_BADGE_FALLBACK = PR_STATUS_BADGE_CONFIG.open;

/** Compact list/header indicator — icon color only. */
export const PR_STATUS_ICON_CLASS = {
  open: 'text-emerald-400',
  draft: 'text-zinc-400',
  merged: 'text-violet-300 drop-shadow-[0_0_5px_rgba(167,139,250,0.75)]',
  closed: 'text-red-400',
};

const SESSION_FAILED_CLASS = 'text-red-400';

const PULSE_STATUSES = new Set(['running', 'provisioning', 'archiving', 'approval']);

export function prListIndicatorProps(session) {
  const status = session.pr_status || 'open';
  const config = PR_STATUS_BADGE_CONFIG[status] ?? PR_STATUS_BADGE_FALLBACK;
  const failed = session.status === 'failed' || session.status === 'error';
  const iconClass = failed
    ? SESSION_FAILED_CLASS
    : (PR_STATUS_ICON_CLASS[status] ?? PR_STATUS_ICON_CLASS.open);
  const pulse = PULSE_STATUSES.has(session.status);
  return {
    icon: config.icon,
    iconClass: `${iconClass}${pulse ? ' animate-pulse' : ''}`,
    title: config.title,
  };
}
