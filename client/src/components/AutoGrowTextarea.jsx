import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

/** Pixel line-height. Hidden or not-yet-laid-out textareas can report a unitless ratio. */
function lineHeightPx(style) {
  const fontSize = parseFloat(style.fontSize);
  const fontPx = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
  const parsed = parseFloat(style.lineHeight);
  if (!Number.isFinite(parsed) || parsed <= 0) return fontPx * 1.25;
  if (parsed < fontPx / 2) return parsed * fontPx;
  return parsed;
}

function maxHeightPxFor(el, { maxHeightPx, maxLines }) {
  if (maxHeightPx != null) return maxHeightPx;
  return lineHeightPx(getComputedStyle(el)) * maxLines;
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

/**
 * Declared `rows` minimum border-box height from computed styles.
 * Does not read or write inline height — a collapsed layout (client navigation,
 * display:none) must not turn the floor into a sub-line scrollHeight.
 */
function intrinsicRowsHeightPx(el, rowCount) {
  const style = getComputedStyle(el);
  const lh = lineHeightPx(style);
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const border =
    (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  const rowsN = Math.max(1, Number(rowCount) || Number(el.rows) || 1);
  return Math.ceil(rowsN * lh + padding + border);
}

function syncHeight(el, limits, fitOpts = {}) {
  if (!el) return 0;
  const maxPx = maxHeightPxFor(el, limits);
  const rowsFloorPx = intrinsicRowsHeightPx(el, limits.rowCount);
  const minPx = Math.max(limits.minHeightPx ?? 0, rowsFloorPx);
  // Keep the rows floor even if a later pass writes height: 0 while the field is hidden.
  el.style.minHeight = `${rowsFloorPx}px`;
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
          rowCount: rows,
          minHeightPx: keepManualResize ? userMinHeightRef.current : 0,
        },
        { value, placeholder, fitPlaceholderWhenEmpty }
      );
      lastSyncedHeightRef.current = next;
    },
    [value, placeholder, fitPlaceholderWhenEmpty, maxLines, maxHeightPx, keepManualResize, rows]
  );

  useLayoutEffect(() => {
    applySync(innerRef.current);
  }, [applySync]);

  // Empty new-session/loop composers never change `value`, so a measurement taken
  // while the field is still in the previous route's layout would otherwise stick.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => applySync(el));
    return () => cancelAnimationFrame(id);
  }, [applySync]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    let lastWidth = el.offsetWidth;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      const width = el.offsetWidth;
      const becameVisible = lastWidth <= 0 && width > 0;
      lastWidth = width;
      if (!becameVisible) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applySync(el));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [applySync]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !keepManualResize) return;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      // A hidden or not-yet-laid-out field reports 0. Do not treat that as a user drag
      // and do not write height: 0 — that sticks after navigating onto the form.
      if (h <= 0 || el.offsetWidth <= 0) return;
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
