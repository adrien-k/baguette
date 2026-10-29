import { describeSlackUserMessage } from '@baguette/shared/slack-user-message.js';
import type { TypedMessageView } from '@baguette/shared/session-messages.ts';
import UserMessageContent, { userMessagePlainText } from './UserMessageContent.tsx';
import CopyButton from './CopyButton.tsx';
import MessageTimestamp from './MessageTimestamp.tsx';

/**
 * A user turn that came from Slack: labelled "Slack (name)" instead of "You", showing what the
 * person wrote. The Slack context the agent also received is one click away.
 */
export default function SlackBlock({ message }: { message: TypedMessageView & { type: 'user' } }) {
  const slack = describeSlackUserMessage(message);
  if (!slack) return null;
  const agentText = userMessagePlainText(message);
  const note = [slack.suggestion && 'suggestion', slack.untagged && 'not tagged']
    .filter(Boolean)
    .join(', ');

  return (
    <div className="group bg-control rounded-lg p-3 sm:p-4 border border-strong ml-4 sm:ml-8">
      <div className="text-xs text-success mb-1 font-medium flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{slack.label}</span>
          {note && <span className="text-faint font-normal shrink-0">{note}</span>}
          {message.created_at && (
            <MessageTimestamp
              createdAt={message.created_at}
              className="text-faint font-normal shrink-0"
            />
          )}
        </div>
        {slack.text && <CopyButton text={slack.text} />}
      </div>
      <UserMessageContent content={slack.text} message={undefined} />
      {agentText && agentText !== slack.text && (
        <details className="mt-2 text-xs text-fg-muted">
          <summary className="cursor-pointer text-faint">Slack context sent to the agent</summary>
          <div className="mt-1 whitespace-pre-wrap break-words">{agentText}</div>
        </details>
      )}
    </div>
  );
}
