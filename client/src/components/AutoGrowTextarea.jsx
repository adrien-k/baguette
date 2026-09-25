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

function syncHeight(el, limits, fitOpts = {}) {
  if (!el) return;
  const maxPx = maxHeightPxFor(el, limits);
  el.style.height = 'auto';
  el.style.overflowY = 'hidden';

  const contentHeight = measureContentHeight(el, fitOpts);
  if (contentHeight > maxPx) {
    el.style.height = `${maxPx}px`;
    el.style.overflowY = 'auto';
  } else {
    el.style.height = `${contentHeight}px`;
  }
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
    className = '',
    fitPlaceholderWhenEmpty = false,
    placeholder,
    ...rest
  },
  forwardedRef
) {
  const innerRef = useRef(null);
  useImperativeHandle(forwardedRef, () => innerRef.current);

  const limits = { maxLines, maxHeightPx };
  const fitOpts = { value, placeholder, fitPlaceholderWhenEmpty };

  useLayoutEffect(() => {
    syncHeight(innerRef.current, limits, fitOpts);
  }, [value, placeholder, fitPlaceholderWhenEmpty, maxLines, maxHeightPx]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !String(value ?? '').trim()) return;
    const id = requestAnimationFrame(() => syncHeight(el, limits, fitOpts));
    return () => cancelAnimationFrame(id);
  }, [value, placeholder, fitPlaceholderWhenEmpty, maxLines, maxHeightPx]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !fitPlaceholderWhenEmpty || !placeholder) return;
    const ro = new ResizeObserver(() => syncHeight(el, limits, fitOpts));
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, placeholder, fitPlaceholderWhenEmpty, maxLines, maxHeightPx]);

  const handleChange = (e) => {
    onChange?.(e);
    syncHeight(e.target, limits, fitOpts);
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
