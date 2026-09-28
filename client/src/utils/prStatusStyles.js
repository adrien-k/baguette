import { GitPullRequest, GitPullRequestDraft, GitMerge, GitPullRequestClosed } from 'lucide-react';

/** Badge button surfaces (session header / diff bar). */
export const PR_STATUS_BADGE_CONFIG = {
  open: {
    icon: GitPullRequest,
    className:
      'text-success border-success/40 bg-soft-success/40 hover:border-success hover:bg-soft-success/55',
    title: 'Open pull request',
  },
  draft: {
    icon: GitPullRequestDraft,
    className:
      'text-fg-muted border-strong/80 bg-control/40 hover:border-strong hover:bg-control/60',
    title: 'Draft pull request',
  },
  merged: {
    icon: GitMerge,
    className:
      'text-merged border-merged/70 bg-merged/20 shadow-sm shadow-merged/30 ring-1 ring-merged/40 hover:border-merged hover:bg-merged/30 hover:ring-merged/55',
    title: 'Merged pull request',
  },
  closed: {
    icon: GitPullRequestClosed,
    className:
      'text-danger border-danger/40 bg-soft-danger/40 hover:border-danger hover:bg-soft-danger/55',
    title: 'Closed pull request',
  },
};

export const PR_STATUS_BADGE_FALLBACK = PR_STATUS_BADGE_CONFIG.open;

/** Compact list/header indicator — icon color only. */
export const PR_STATUS_ICON_CLASS = {
  open: 'text-success',
  draft: 'text-fg-muted',
  merged: 'text-merged drop-shadow-[0_0_5px_rgba(167,139,250,0.75)]',
  closed: 'text-danger',
};

const SESSION_FAILED_CLASS = 'text-danger';

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
