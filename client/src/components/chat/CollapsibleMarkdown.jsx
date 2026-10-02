import { useEffect, useState } from 'react';
import MarkdownContent from '../MarkdownContent.jsx';
import { CHAT_CONTENT_PREVIEW_LINES, splitPreviewLines } from '../../utils/chatContentPreview.js';

const TOGGLE_CLASS = 'mt-1 text-[11px] text-faint hover:text-secondary transition-colors';

function MoreLinesControl({ remaining, onExpand, onCollapse, expanded, simpleToggle = false }) {
  if (remaining <= 0) return null;
  if (simpleToggle) {
    return (
      <button type="button" onClick={expanded ? onCollapse : onExpand} className={TOGGLE_CLASS}>
        {expanded ? 'Read less' : 'Read more'}
      </button>
    );
  }
  if (expanded) {
    return (
      <button type="button" onClick={onCollapse} className={`${TOGGLE_CLASS} font-mono text-xs`}>
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
      className={`${TOGGLE_CLASS} font-mono text-xs cursor-pointer`}
    >
      &hellip; {remaining} more line{remaining !== 1 ? 's' : ''}
    </span>
  );
}

export default function CollapsibleMarkdown({
  children,
  previewLines = CHAT_CONTENT_PREVIEW_LINES,
  hardBreaks = false,
  simpleToggle = false,
}) {
  const text = children ?? '';
  const [expanded, setExpanded] = useState(false);
  const { preview, remaining } = splitPreviewLines(text, previewLines);
  const showFull = expanded || remaining === 0;

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  return (
    <div>
      <MarkdownContent hardBreaks={hardBreaks}>{showFull ? text : preview}</MarkdownContent>
      <MoreLinesControl
        remaining={remaining}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
        onCollapse={() => setExpanded(false)}
        simpleToggle={simpleToggle}
      />
    </div>
  );
}
