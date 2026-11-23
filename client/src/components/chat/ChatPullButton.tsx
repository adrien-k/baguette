import { ArrowDownToLine, Loader2 } from 'lucide-react';
import { canShowChatPullButton } from '../SessionTools.jsx';
import ChatQuickActionButton, { CHAT_ACTION_BUTTON_CLASS } from './ChatQuickActionButton.tsx';

/** Pull control in the chat quick-action row for remote repository sessions. */
export default function ChatPullButton({
  session,
  readonly = false,
  onPull,
  pulling = false,
  className = CHAT_ACTION_BUTTON_CLASS,
}: {
  session?: Record<string, unknown> | null;
  readonly?: boolean;
  onPull?: () => void | Promise<void>;
  pulling?: boolean;
  className?: string;
}) {
  if (!canShowChatPullButton(session, { readonly, onPull })) {
    return null;
  }

  return (
    <ChatQuickActionButton
      icon={pulling ? Loader2 : ArrowDownToLine}
      label={pulling ? 'Pulling…' : 'Pull'}
      tooltip="Pull latest commits from the remote branch into this worktree."
      onClick={onPull}
      disabled={pulling}
      className={className}
      iconClassName={pulling ? 'animate-spin text-brand' : undefined}
      data-testid="chat-pull-button"
    />
  );
}
