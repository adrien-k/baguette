import UserMessageContent from './UserMessageContent.tsx';
import CopyButton from './CopyButton.tsx';

/** Placeholder user bubble for session `initial_prompt` before the first DB message exists. */
export default function PendingInitialPromptMessage({ text }) {
  return (
    <div className="group bg-control rounded-lg p-3 sm:p-4 border border-strong ml-4 sm:ml-8">
      <div className="text-xs text-success mb-1 font-medium flex items-center justify-between gap-2">
        <span className="shrink-0">You</span>
        {text ? <CopyButton text={text} /> : null}
      </div>
      <UserMessageContent content={text} />
    </div>
  );
}
