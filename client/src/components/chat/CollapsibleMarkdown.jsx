import { useState } from 'react';
import MarkdownContent from '../MarkdownContent.jsx';
import { CHAT_CONTENT_PREVIEW_LINES, splitPreviewLines } from '../../utils/chatContentPreview.js';

function MoreLinesControl({ remaining, onExpand, onCollapse, expanded }) {
  if (remaining <= 0) return null;
  if (expanded) {
    return (
      <button
        type="button"
        onClick={onCollapse}
        className="text-faint hover:text-fg-muted transition-colors mt-1 font-mono text-xs"
      >
        Show less
      </button>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onExpand();
        }
      }}
      className="text-faint hover:text-fg-muted transition-colors mt-1 font-mono text-xs cursor-pointer"
    >
      &hellip; {remaining} more line{remaining !== 1 ? 's' : ''}
    </span>
  );
}

export default function CollapsibleMarkdown({
  children,
  previewLines = CHAT_CONTENT_PREVIEW_LINES,
  hardBreaks = false,
}) {
  const text = children ?? '';
  const [expanded, setExpanded] = useState(false);
  const { preview, remaining } = splitPreviewLines(text, previewLines);
  const showFull = expanded || remaining === 0;

  return (
    <div>
      <MarkdownContent hardBreaks={hardBreaks}>{showFull ? text : preview}</MarkdownContent>
      <MoreLinesControl
        remaining={remaining}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
        onCollapse={() => setExpanded(false)}
      />
    </div>
  );
}
