import type {
  ChatMessageView,
  MessageViewMeta,
  TypedMessageView,
} from '@baguette/shared/session-messages.ts';
import UserMessageContent, { userMessagePlainText } from './chat/UserMessageContent.tsx';
import CollapsibleMarkdown from './chat/CollapsibleMarkdown.tsx';
import ThinkingBlock from './chat/ThinkingBlock.tsx';
import ToolCallBlock from './chat/ToolCallBlock.tsx';
import BaguetteBlock from './chat/BaguetteBlock.tsx';
import PlanReviewBlock from './chat/PlanReviewBlock.tsx';
import AskUserAnswerBlock from './chat/AskUserAnswerBlock.tsx';
import CopyButton from './chat/CopyButton.tsx';
import {
  isHumanUserMessage,
  isLoopUserMessage,
  isMcpUserMessage,
} from '@baguette/shared/turn-model.js';
import { isSlackUserMessage } from '@baguette/shared/slack-user-message.js';
import InjectedUserTurnBlock from './chat/InjectedUserTurnBlock.jsx';
import McpAgentBlock from './chat/McpAgentBlock.tsx';
import SlackBlock from './chat/SlackBlock.tsx';
import MessageTimestamp from './chat/MessageTimestamp.tsx';
import MessageTurnModelBadge from './chat/MessageTurnModelBadge.jsx';
import TurnErrorMessage from './chat/TurnErrorMessage.tsx';

export type ChatMessageProps = {
  message: ChatMessageView;
  isLatestMessage?: boolean;
  sessionPath?: string | null;
  sessionId?: number | null;
  agentName?: string;
  messageIndex: number | null;
  allMessages: ChatMessageView[] | null;
  pinnedRunningBashIds?: Set<string>;
};

function UserMessageModelBadge({
  message,
}: {
  message: MessageViewMeta & {
    model?: string | null;
    model_params?: unknown;
  };
}) {
  return (
    <MessageTurnModelBadge
      model={message.model}
      modelParams={message.model_params}
      agentConfigId={message.agent_config_id}
      className="text-faint font-normal text-xs text-right"
    />
  );
}

function TypedUserMessage({ message }: { message: TypedMessageView & { type: 'user' } }) {
  const isBaguette = message.source === 'baguette' || message.subtype === 'baguette';
  if (isBaguette) {
    return <BaguetteBlock message={message} />;
  }

  if (isLoopUserMessage(message)) {
    return <InjectedUserTurnBlock label="Loop" defaultTitle="Loop run" message={message} />;
  }

  if (isMcpUserMessage(message)) {
    return <McpAgentBlock message={message} />;
  }

  if (message.subtype === 'ask_user_answer') {
    const answers = (message as { answers?: { question?: string; value?: string }[] }).answers;
    const userText = userMessagePlainText(message);
    return (
      <div className="group bg-control rounded-lg p-3 sm:p-4 border border-strong ml-4 sm:ml-8">
        <div className="text-xs text-success mb-1 font-medium flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0">You</span>
            {message.created_at && (
              <MessageTimestamp
                createdAt={message.created_at}
                className="text-faint font-normal shrink-0"
              />
            )}
          </div>
          <UserMessageModelBadge message={message} />
        </div>
        <AskUserAnswerBlock answers={answers} fallbackText={userText} />
      </div>
    );
  }

  if (isSlackUserMessage(message)) {
    return <SlackBlock message={message} />;
  }

  const userText = userMessagePlainText(message);
  return (
    <div className="group bg-control rounded-lg p-3 sm:p-4 border border-strong ml-4 sm:ml-8">
      <div className="text-xs text-success mb-1 font-medium flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">You</span>
          {message.created_at && (
            <MessageTimestamp
              createdAt={message.created_at}
              className="text-faint font-normal shrink-0"
            />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          {isHumanUserMessage(message) && <UserMessageModelBadge message={message} />}
          {userText && <CopyButton text={userText} />}
        </div>
      </div>
      <UserMessageContent
        content={message.content}
        message={(message as { message?: { content?: unknown } }).message}
      />
    </div>
  );
}

function SystemMessage({ message }: { message: TypedMessageView & { type: 'system' } }) {
  if (message.subtype === 'prompt') return null;

  if (message.subtype === 'thinking_tokens') {
    const tokens = message.estimated_tokens ?? 0;
    return (
      <div className="text-xs text-faint text-center py-1">
        Thinking… ~{tokens.toLocaleString()} tokens
      </div>
    );
  }

  if (message.subtype === 'task') {
    return (
      <div className="text-xs text-faint text-center py-1">
        {message.task_status ? (
          <span className="text-faint mr-1">[{message.task_status}]</span>
        ) : null}
        {message.text}
      </div>
    );
  }

  if (message.subtype === 'request') {
    return (
      <div className="text-xs text-accent/80 text-center py-1">
        Agent is awaiting your input or approval
      </div>
    );
  }

  if (message.subtype === 'init') {
    return <div className="text-xs text-faint text-center py-1">Session started</div>;
  }

  if (message.subtype === 'status' && message.status) {
    return <div className="text-xs text-faint text-center py-1">{message.status}</div>;
  }

  const label =
    message.summary ||
    message.description ||
    message.text ||
    message.status ||
    message.subtype ||
    '';
  return <div className="text-xs text-faint text-center py-1">{label}</div>;
}

function TypedMessage(
  props: Omit<ChatMessageProps, 'message'> & { message: TypedMessageView; userReplied: boolean }
) {
  const {
    message,
    isLatestMessage,
    sessionPath,
    sessionId,
    agentName = 'Agent',
    pinnedRunningBashIds,
    userReplied,
  } = props;
  switch (message.type) {
    case 'plan':
      return (
        <PlanReviewBlock
          markdown={message.markdown}
          sessionId={sessionId}
          agentId={message.agent_id}
          userReplied={userReplied}
        />
      );

    case 'tool_call': {
      const call = message as TypedMessageView & { call_id?: string | null };
      if (pinnedRunningBashIds?.has(call.call_id ?? `tool-${message.id}`)) return null;
      return (
        <ToolCallBlock
          message={message}
          sessionPath={sessionPath}
          sessionId={sessionId ?? undefined}
          userReplied={userReplied}
        />
      );
    }

    case 'assistant': {
      const firstTextBlockIndex = message.blocks.findIndex((b) => b.type === 'text');
      return (
        <div className="space-y-2">
          {message.blocks.map((block, i) => {
            if (block.type === 'text') {
              return (
                <div key={i} className="group bg-nav rounded-lg p-3 sm:p-4 border border-line">
                  <div className="text-xs text-info mb-1 font-medium flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0">{agentName}</span>
                      {i === firstTextBlockIndex && message.created_at && (
                        <MessageTimestamp
                          createdAt={message.created_at}
                          className="text-faint font-normal shrink-0"
                        />
                      )}
                    </div>
                    <CopyButton text={block.text} />
                  </div>
                  <CollapsibleMarkdown key={`${message.id}-${i}`}>{block.text}</CollapsibleMarkdown>
                </div>
              );
            }
            if (block.type === 'thinking') {
              return <ThinkingBlock key={i} block={block} isLatestMessage={isLatestMessage} />;
            }
            return null;
          })}
        </div>
      );
    }

    case 'user':
      return <TypedUserMessage message={message} />;

    case 'turn_result': {
      const isError = message.status === 'error';
      if (isError && message.error_message) {
        return (
          <div className="flex justify-center px-2">
            <TurnErrorMessage errorMessage={message.error_message} />
          </div>
        );
      }
      return (
        <div className="text-center text-xs opacity-70 text-success">
          <span className="font-medium">Completed</span>
        </div>
      );
    }

    case 'system':
      return <SystemMessage message={message} />;

    default:
      return null;
  }
}

export default function ChatMessage(props: ChatMessageProps) {
  const { message, messageIndex, allMessages } = props;

  if (message.type === 'tool_result_carrier') {
    return null;
  }

  const userReplied = (() => {
    if (!allMessages || messageIndex == null) return false;
    return allMessages.slice(messageIndex + 1).some((m) => {
      if (!isHumanUserMessage(m)) return false;
      const source = (m as { source?: string }).source;
      return source !== 'baguette' && source !== 'loop';
    });
  })();

  return (
    <TypedMessage {...props} message={message as TypedMessageView} userReplied={userReplied} />
  );
}
