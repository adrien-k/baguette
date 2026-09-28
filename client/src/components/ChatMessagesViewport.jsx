import { SCROLL_BOTTOM_THRESHOLD_PX } from '../utils/scrollBottom.js';
import StickToBottomScrollArea from './StickToBottomScrollArea.jsx';

/** @deprecated use SCROLL_BOTTOM_THRESHOLD_PX from utils/scrollBottom.js */
export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = SCROLL_BOTTOM_THRESHOLD_PX;

/** Centered content width (padding), matching Dashboard `max-w-5xl mx-auto px-4`. */
export const CHAT_COLUMN_CLASS = 'w-full max-w-5xl mx-auto px-4';

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
