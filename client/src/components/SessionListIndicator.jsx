import { Circle } from 'lucide-react';
import { sessionHasUnreadActivity } from '@baguette/shared/session-unread.js';
import SessionStatusIndicator from './SessionStatusIndicator.jsx';

/** Brand dot shown left of the session title when activity is newer than last view. */
export function SessionUnreadDot({ session, className = '' }) {
  const unread = sessionHasUnreadActivity(session);
  if (!unread) return null;

  return (
    <Circle
      className={`w-2 h-2 shrink-0 fill-brand text-brand ${className}`.trim()}
      aria-label="Unread activity"
      title="Unread activity"
    />
  );
}

/** Left-column status icon for session rows/cards. */
export default function SessionListIndicator({ session, size = 'sm' }) {
  return <SessionStatusIndicator session={session} size={size} />;
}
