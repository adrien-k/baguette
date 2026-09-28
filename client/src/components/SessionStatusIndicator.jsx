import { Archive, Loader2 } from 'lucide-react';
import { SessionStatusIcon } from './SessionCard.jsx';
import { prListIndicatorProps } from '../utils/prStatusStyles.js';

const SIZE_CLASS = {
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
};

/** Archive, PR, or session status icon — shared by session sidebar and dashboard cards. */
export default function SessionStatusIndicator({ session, size = 'sm' }) {
  const iconSize = SIZE_CLASS[size] ?? SIZE_CLASS.sm;
  const isArchived = !!session.archived_at;
  const isArchiving = !isArchived && session.status === 'archiving';
  const hasPr = session.pr_number != null;

  if (isArchived) {
    return <Archive className={`${iconSize} text-faint shrink-0`} aria-hidden />;
  }
  if (isArchiving) {
    return <Loader2 className={`${iconSize} text-accent/80 animate-spin shrink-0`} aria-hidden />;
  }
  if (hasPr) {
    const { icon: PrIcon, iconClass, title } = prListIndicatorProps(session);
    return <PrIcon className={`${iconSize} shrink-0 ${iconClass}`} aria-hidden title={title} />;
  }
  return <SessionStatusIcon status={session.status} compact={size === 'sm'} aria-hidden />;
}
