import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

function maxHeightPxFor(el, { maxHeightPx, maxLines }) {
  if (maxHeightPx != null) return maxHeightPx;
  const lineHeight = parseInt(getComputedStyle(el).lineHeight, 10) || 20;
  return lineHeight * maxLines;
}

function measureContentHeight(el, { value, placeholder, fitPlaceholderWhenEmpty }) {
  const empty = !String(value ?? '').trim();
  if (fitPlaceholderWhenEmpty && empty && placeholder) {
    const saved = el.value;
    const selStart = el.selectionStart;
    const selEnd = el.selectionEnd;
    el.value = placeholder;
    const h = el.scrollHeight;
    el.value = saved;
    if (typeof el.setSelectionRange === 'function') {
      el.setSelectionRange(selStart, selEnd);
    }
    return h;
  }
  return el.scrollHeight;
}

/** True when observer height matches a height we just set in syncHeight (not a user drag). */
function isProgrammaticHeight(observerHeight, syncedHeight) {
  return syncedHeight >= 0 && Math.abs(observerHeight - syncedHeight) <= 1;
}

/** Reset inline height so scrollHeight reflects content (0px, not auto — auto can collapse). */
function resetHeightForMeasure(el) {
  el.style.height = '0px';
}

/** Declared `rows` minimum height from computed styles (never mutates `value`). */
function intrinsicRowsHeightPx(el) {
  const style = getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight);
  const lh = Number.isFinite(lineHeight) ? lineHeight : 20;
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const border =
    (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  const rowCount = Math.max(1, Number(el.rows) || 1);
  const fromStyle = rowCount * lh + padding + border;
  if (el.offsetHeight > 0) return fromStyle;
  resetHeightForMeasure(el);
  const fallback = el.scrollHeight;
  return fallback > 0 ? fallback : fromStyle;
}

function syncHeight(el, limits, fitOpts = {}) {
  if (!el) return 0;
  const maxPx = maxHeightPxFor(el, limits);
  const rowsFloorPx = intrinsicRowsHeightPx(el);
  const minPx = Math.max(limits.minHeightPx ?? 0, rowsFloorPx);
  resetHeightForMeasure(el);
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

  const applySync = useCallback(
    (el) => {
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
    },
    [value, placeholder, fitPlaceholderWhenEmpty, maxLines, maxHeightPx, keepManualResize]
  );

  useLayoutEffect(() => {
    applySync(innerRef.current);
  }, [applySync]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !String(value ?? '').trim()) return;
    const id = requestAnimationFrame(() => applySync(el));
    return () => cancelAnimationFrame(id);
  }, [applySync, value]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !keepManualResize) return;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (isProgrammaticHeight(h, lastSyncedHeightRef.current)) return;
      const floor = intrinsicRowsHeightPx(el);
      if (floor > 0 && h < floor - 1) {
        userMinHeightRef.current = 0;
        return;
      }
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
