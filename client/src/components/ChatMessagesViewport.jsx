import { SCROLL_BOTTOM_THRESHOLD_PX } from '../utils/scrollBottom.js';
import StickToBottomScrollArea from './StickToBottomScrollArea.jsx';

/** @deprecated use SCROLL_BOTTOM_THRESHOLD_PX from utils/scrollBottom.js */
export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = SCROLL_BOTTOM_THRESHOLD_PX;

/** Centered narrow column for session chat, details, preview, and review issues. */
export const SESSION_CONTENT_MAX_WIDTH_CLASS = 'w-full max-w-2xl mx-auto';

/** Centered content width with horizontal padding (session chat composer and messages). */
export const CHAT_COLUMN_CLASS = `${SESSION_CONTENT_MAX_WIDTH_CLASS} px-4`;

/**
 * Scrollable message list with optional bottom fade above the composer (session + review chat).
 */
export default function ChatMessagesViewport({
  children,
  showBottomFade = false,
  scrollRef,
  className = '',
  showScrollToBottom = true,
}) {
  return (
    <div className={`relative flex-1 min-h-0 min-w-0 ${className}`}>
      <StickToBottomScrollArea
        scrollRef={scrollRef}
        className="absolute inset-0"
        scrollClassName="h-full w-full overflow-auto pb-2"
        showScrollToBottom={showScrollToBottom}
        scrollButtonClassName="bottom-5 left-1/2 -translate-x-1/2"
      >
        <div className={`${CHAT_COLUMN_CLASS} py-3 sm:py-4 space-y-3`}>{children}</div>
      </StickToBottomScrollArea>
      {showBottomFade && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-page to-transparent z-[1]"
          aria-hidden
        />
      )}
    </div>
  );
}
