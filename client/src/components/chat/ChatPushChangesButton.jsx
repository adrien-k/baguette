import { Upload } from 'lucide-react';
import { canShowChatPushChangesBar } from '../SessionTools.jsx';
import ChatQuickActionButton, { CHAT_ACTION_BUTTON_CLASS } from './ChatQuickActionButton.jsx';

/** Push control in the chat quick-action row when there are unpushed commits. */
export default function ChatPushChangesButton({
  session,
  readonly = false,
  onPush,
  pushing = false,
  commitsToPush = 0,
  className = CHAT_ACTION_BUTTON_CLASS,
}) {
  if (!canShowChatPushChangesBar(session, { readonly, onPush, commitsToPush })) {
    return null;
  }

  return (
    <ChatQuickActionButton
      icon={Upload}
      label={pushing ? 'Pushing…' : 'Push changes'}
      tooltip="Push local commits to GitHub and update the pull request."
      onClick={onPush}
      disabled={pushing}
      className={className}
    >
      <span className="flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-brand text-white text-[10px] font-bold leading-none shrink-0">
        {commitsToPush}
      </span>
    </ChatQuickActionButton>
  );
}
