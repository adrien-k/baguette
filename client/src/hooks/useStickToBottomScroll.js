import { useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { SCROLL_BOTTOM_THRESHOLD_PX, isAtScrollBottom } from '../utils/scrollBottom.js';

/**
 * Stick-to-bottom scroll for chronological feeds (chat, logs, review).
 * Preserves scroll position when prepending via prepareLoadMore().
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

  useEffect(() => {
    isAtBottomRef.current = true;
  }, [resetKey]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      isAtBottomRef.current = isAtScrollBottom(container, threshold);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [threshold]);

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
    if (!isLoadingMoreRef.current && isAtBottomRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [contentLength]);

  useLayoutEffect(() => {
    if (loading || !scrollContainerRef.current || isLoadingMoreRef.current) return;
    if (!isAtBottomRef.current) return;
    scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
  }, [loading, resetKey]);

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
    el.scrollTo({ top: el.scrollHeight, behavior });
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
