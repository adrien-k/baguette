import { useState, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';

/** Match auto-scroll / “at bottom” detection in ChatView and ReviewAgentPanel. */
export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 80;

/** Centered content width (padding), matching Dashboard `max-w-5xl mx-auto px-4`. */
export const CHAT_COLUMN_CLASS = 'w-full max-w-5xl mx-auto px-4';

function isScrolledAboveBottom(container, thresholdPx = CHAT_SCROLL_BOTTOM_THRESHOLD_PX) {
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollTop + clientHeight < scrollHeight - thresholdPx;
}

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
  const [showScrollButton, setShowScrollButton] = useState(false);

  const updateScrollButton = useCallback(() => {
    const el = scrollRef?.current;
    if (!el || !showScrollToBottom) {
      setShowScrollButton(false);
      return;
    }
    setShowScrollButton(isScrolledAboveBottom(el));
  }, [scrollRef, showScrollToBottom]);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el || !showScrollToBottom) {
      setShowScrollButton(false);
      return;
    }
    updateScrollButton();
    el.addEventListener('scroll', updateScrollButton, { passive: true });
    const ro = new ResizeObserver(updateScrollButton);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollButton);
      ro.disconnect();
    };
  }, [scrollRef, showScrollToBottom, updateScrollButton, children]);

  const scrollToBottom = () => {
    const el = scrollRef?.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className={`relative flex-1 min-h-0 min-w-0 ${className}`}>
      <div ref={scrollRef} className="absolute inset-0 overflow-auto pb-14">
        <div className={`${CHAT_COLUMN_CLASS} py-3 sm:py-4 space-y-3`}>{children}</div>
      </div>
      {showBottomFade && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-zinc-950 to-transparent z-[1]"
          aria-hidden
        />
      )}
      {showScrollToBottom && showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          className="absolute z-[2] bottom-5 right-4 sm:right-6 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-800/95 text-zinc-300 shadow-md hover:border-sky-500/35 hover:bg-zinc-800 hover:text-sky-200 transition-colors"
        >
          <ChevronDown className="w-4 h-4 shrink-0" aria-hidden />
        </button>
      )}
    </div>
  );
}
