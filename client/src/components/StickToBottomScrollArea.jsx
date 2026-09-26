import { useState, useEffect, useCallback } from 'react';
import { isScrolledAboveBottom } from '../utils/scrollBottom.js';
import ScrollToBottomFab from './ScrollToBottomFab.jsx';

/**
 * Relative wrapper + scroll container with optional scroll-to-bottom FAB.
 */
export default function StickToBottomScrollArea({
  scrollRef,
  children,
  className = 'relative flex-1 min-h-0 min-w-0',
  scrollClassName = 'absolute inset-0 overflow-auto',
  showScrollToBottom = true,
  scrollButtonClassName,
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
    <div className={className}>
      <div ref={scrollRef} className={scrollClassName}>
        {children}
      </div>
      {showScrollToBottom && showScrollButton && (
        <ScrollToBottomFab onClick={scrollToBottom} className={scrollButtonClassName} />
      )}
    </div>
  );
}
