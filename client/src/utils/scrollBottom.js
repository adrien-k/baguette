/** Match auto-scroll / “at bottom” detection in chat, logs, and review panels. */
export const SCROLL_BOTTOM_THRESHOLD_PX = 80;

export function isScrolledAboveBottom(container, thresholdPx = SCROLL_BOTTOM_THRESHOLD_PX) {
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollTop + clientHeight < scrollHeight - thresholdPx;
}

export function isAtScrollBottom(container, thresholdPx = SCROLL_BOTTOM_THRESHOLD_PX) {
  return !isScrolledAboveBottom(container, thresholdPx);
}
