import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';

function maxHeightPxFor(el, { maxHeightPx, maxLines }) {
  if (maxHeightPx != null) return maxHeightPx;
  const lineHeight = parseInt(getComputedStyle(el).lineHeight, 10) || 20;
  return lineHeight * maxLines;
}

function measureContentHeight(el, { value, placeholder, fitPlaceholderWhenEmpty }) {
  const empty = !String(value ?? '').trim();
  if (fitPlaceholderWhenEmpty && empty && placeholder) {
    const saved = el.value;
    el.value = placeholder;
    const h = el.scrollHeight;
    el.value = saved;
    return h;
  }
  return el.scrollHeight;
}

/** True when observer height matches a height we just set in syncHeight (not a user drag). */
function isProgrammaticHeight(observerHeight, syncedHeight) {
  return syncedHeight >= 0 && Math.abs(observerHeight - syncedHeight) <= 1;
}

function syncHeight(el, limits, fitOpts = {}) {
  if (!el) return 0;
  const maxPx = maxHeightPxFor(el, limits);
  const minPx = limits.minHeightPx ?? 0;
  el.style.height = 'auto';
  el.style.overflowY = 'hidden';

  const contentHeight = measureContentHeight(el, fitOpts);
  const next = Math.max(minPx, contentHeight > maxPx ? maxPx : contentHeight);
  el.style.height = `${next}px`;
  if (contentHeight > next) {
    el.style.overflowY = 'auto';
  }
  return next;
}

/**
 * Textarea that grows with content up to maxLines (or maxHeightPx).
 */
const AutoGrowTextarea = forwardRef(function AutoGrowTextarea(
  {
    value,
    onChange,
    rows = 3,
    maxLines = 20,
    maxHeightPx,
    keepManualResize = false,
    className = '',
    fitPlaceholderWhenEmpty = false,
    placeholder,
    ...rest
  },
  forwardedRef
) {
  const innerRef = useRef(null);
  const userMinHeightRef = useRef(0);
  /** Last height written by syncHeight; ResizeObserver ignores matching sizes. */
  const lastSyncedHeightRef = useRef(-1);
  useImperativeHandle(forwardedRef, () => innerRef.current);

  const applySync = (el) => {
    if (!el) return;
    const next = syncHeight(
      el,
      {
        maxLines,
        maxHeightPx,
        minHeightPx: keepManualResize ? userMinHeightRef.current : 0,
      },
      { value, placeholder, fitPlaceholderWhenEmpty }
    );
    lastSyncedHeightRef.current = next;
  };

  useLayoutEffect(() => {
    applySync(innerRef.current);
  }, [value, placeholder, fitPlaceholderWhenEmpty, maxLines, maxHeightPx, keepManualResize]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !String(value ?? '').trim()) return;
    const id = requestAnimationFrame(() => applySync(el));
    return () => cancelAnimationFrame(id);
  }, [value, placeholder, fitPlaceholderWhenEmpty, maxLines, maxHeightPx, keepManualResize]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !fitPlaceholderWhenEmpty || !placeholder) return;
    const ro = new ResizeObserver(() => applySync(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, placeholder, fitPlaceholderWhenEmpty, maxLines, maxHeightPx, keepManualResize]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !keepManualResize) return;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (isProgrammaticHeight(h, lastSyncedHeightRef.current)) return;
      userMinHeightRef.current = h;
      lastSyncedHeightRef.current = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [keepManualResize]);

  const handleChange = (e) => {
    onChange?.(e);
    applySync(e.target);
  };

  return (
    <textarea
      ref={innerRef}
      rows={rows}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      className={`overflow-hidden ${className}`}
      {...rest}
    />
  );
});

export default AutoGrowTextarea;
