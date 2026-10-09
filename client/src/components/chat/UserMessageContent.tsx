import type { UserContentBlock } from '@baguette/shared/message-types.ts';
import { expandUserContentForAgent } from '@baguette/shared/user-message-content.js';
import MarkdownContent from '../MarkdownContent.jsx';
import FileReferenceBlock from './FileReferenceBlock.tsx';

type MessageShape = {
  content?: string | UserContentBlock[];
  message?: { content?: unknown };
};

/** Typed `content` array or legacy SDK `message.content` blocks (text + file_reference). */
function userContentBlocksFromMessage(msg: MessageShape): UserContentBlock[] | null {
  if (Array.isArray(msg.content)) return msg.content;
  const legacy = msg.message?.content;
  if (!Array.isArray(legacy)) return null;
  const blocks = legacy.filter(
    (b): b is UserContentBlock =>
      Boolean(b) && typeof b === 'object' && (b.type === 'text' || b.type === 'file_reference')
  );
  return blocks.length > 0 ? blocks : null;
}

export function userMessagePlainText(msg: MessageShape): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return expandUserContentForAgent(msg.content);
  const legacy = msg.message?.content;
  if (typeof legacy === 'string') return legacy;
  if (Array.isArray(legacy)) return expandUserContentForAgent(legacy);
  return '';
}

type UserMessageContentProps = {
  content?: string | UserContentBlock[];
  message?: { content?: unknown };
  /** When false, text blocks render as plain pre-wrapped divs (logs). */
  markdown?: boolean;
  textClassName?: string;
};

export default function UserMessageContent({
  content,
  message,
  markdown = true,
  textClassName = '',
}: UserMessageContentProps) {
  const blocks = userContentBlocksFromMessage({ content, message });
  if (blocks) {
    return (
      <div className="space-y-2">
        {blocks.map((block, i) => {
          if (block.type === 'text') {
            if (markdown) {
              return (
                <MarkdownContent key={i} hardBreaks>
                  {block.text}
                </MarkdownContent>
              );
            }
            return (
              <div key={i} className={textClassName}>
                {block.text}
              </div>
            );
          }
          if (block.type === 'file_reference') {
            return <FileReferenceBlock key={i} block={block} />;
          }
          return null;
        })}
      </div>
    );
  }

  const text = typeof content === 'string' ? content : userMessagePlainText({ content, message });
  if (markdown) {
    return <MarkdownContent hardBreaks>{text}</MarkdownContent>;
  }
  return <div className={textClassName}>{text}</div>;
}
