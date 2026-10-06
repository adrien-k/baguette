import { useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { SCROLL_BOTTOM_THRESHOLD_PX, isAtScrollBottom } from '../utils/scrollBottom.js';

/**
 * Stick-to-bottom scroll for chronological feeds (chat, logs, review).
 * Preserves scroll position when prepending via prepareLoadMore().
 * Starts pinned to the bottom (new session / initial load); stops auto-scroll after the user scrolls up.
 */
export function useStickToBottomScroll({
  resetKey,
  contentLength,
  loading = false,
  threshold = SCROLL_BOTTOM_THRESHOLD_PX,
}) {
  const scrollContainerRef = useRef(null);
  const scrollAnchor = useRef(null);
  const isLoadingMoreRef = useRef(false);
  const isAtBottomRef = useRef(true);

  const pinScrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    isAtBottomRef.current = true;
  }, [resetKey]);

  useLayoutEffect(() => {
    isAtBottomRef.current = true;
    pinScrollToBottom();
    const frame = requestAnimationFrame(() => {
      pinScrollToBottom();
      requestAnimationFrame(pinScrollToBottom);
    });
    return () => cancelAnimationFrame(frame);
  }, [resetKey, pinScrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      isAtBottomRef.current = isAtScrollBottom(container, threshold);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [resetKey, threshold]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const maybePin = () => {
      if (!isAtBottomRef.current || isLoadingMoreRef.current) return;
      pinScrollToBottom();
    };

    const ro = new ResizeObserver(maybePin);
    const observeContent = () => {
      ro.disconnect();
      const content = container.firstElementChild;
      if (content) ro.observe(content);
      maybePin();
    };
    observeContent();

    const mo = new MutationObserver(observeContent);
    mo.observe(container, { childList: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [resetKey, contentLength, pinScrollToBottom]);

  useLayoutEffect(() => {
    if (scrollAnchor.current && scrollContainerRef.current) {
      const { scrollTop, scrollHeight } = scrollAnchor.current;
      const newScrollHeight = scrollContainerRef.current.scrollHeight;
      scrollContainerRef.current.scrollTop = scrollTop + (newScrollHeight - scrollHeight);
      scrollAnchor.current = null;
    }
    if (!isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = false;
  }, [contentLength]);

  useLayoutEffect(() => {
    if (!isLoadingMoreRef.current && isAtBottomRef.current) {
      pinScrollToBottom();
    }
  }, [contentLength, pinScrollToBottom]);

  useLayoutEffect(() => {
    if (loading || isLoadingMoreRef.current) return;
    if (!isAtBottomRef.current) return;
    pinScrollToBottom();
  }, [loading, resetKey, pinScrollToBottom]);

  const prepareLoadMore = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollAnchor.current = {
        scrollTop: scrollContainerRef.current.scrollTop,
        scrollHeight: scrollContainerRef.current.scrollHeight,
      };
    }
    isLoadingMoreRef.current = true;
  }, []);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (behavior === 'auto' || behavior === 'instant') {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
    isAtBottomRef.current = true;
  }, []);

  return {
    scrollContainerRef,
    isAtBottomRef,
    prepareLoadMore,
    scrollToBottom,
    isLoadingMoreRef,
  };
}
