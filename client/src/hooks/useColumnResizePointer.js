import { useCallback, useEffect, useRef } from 'react';

/**
 * Pointer-drag resize for a vertical column edge.
 * @param {(clientX: number, startX: number, startWidth: number) => number} computeWidth
 * @param {(nextWidth: number, viewportWidth: number) => number} clampWidth
 * @param {{ onActiveChange?: (active: boolean) => void, setLiveWidth?: (px: number) => void }} [options]
 *   When `setLiveWidth` is set, width updates go to the DOM during drag and `setWidth` runs once on release
 *   (avoids React re-renders and localStorage writes per pointermove).
 */
export function useColumnResizePointer(computeWidth, clampWidth, options = {}) {
  const { onActiveChange, setLiveWidth } = options;
  const dragAbortRef = useRef(null);

  useEffect(() => {
    return () => {
      dragAbortRef.current?.abort();
    };
  }, []);

  return useCallback(
    (event, startWidth, setWidth) => {
      dragAbortRef.current?.abort();
      dragAbortRef.current = null;

      event.preventDefault();
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);
      const startX = event.clientX;
      let lastWidth = clampWidth(computeWidth(startX, startX, startWidth), window.innerWidth);

      let finished = false;
      const abort = new AbortController();
      dragAbortRef.current = abort;
      const { signal } = abort;

      const finish = (fromAbort = false) => {
        if (finished) return;
        finished = true;
        if (!fromAbort) abort.abort();
        dragAbortRef.current = null;
        try {
          if (handle.hasPointerCapture(pointerId)) {
            handle.releasePointerCapture(pointerId);
          }
        } catch {
          // capture may already be released (lostpointercapture / pointercancel)
        }
        onActiveChange?.(false);
        if (setLiveWidth) {
          setWidth(lastWidth);
        }
      };

      const onMove = (ev) => {
        const raw = computeWidth(ev.clientX, startX, startWidth);
        lastWidth = clampWidth(raw, window.innerWidth);
        if (setLiveWidth) {
          setLiveWidth(lastWidth);
        } else {
          setWidth(lastWidth);
        }
      };

      signal.addEventListener('abort', () => finish(true));

      handle.addEventListener('pointermove', onMove, { signal });
      handle.addEventListener('pointerup', () => finish(false), { signal });
      handle.addEventListener('pointercancel', () => finish(false), { signal });
      handle.addEventListener(
        'lostpointercapture',
        (ev) => {
          if (ev.pointerId === pointerId) finish(false);
        },
        { signal }
      );

      onActiveChange?.(true);
      if (setLiveWidth) {
        setLiveWidth(lastWidth);
      }
    },
    [computeWidth, clampWidth, onActiveChange, setLiveWidth]
  );
}

/** Right edge of a left column: drag right to widen. */
export function widenFromRightEdge(clientX, startX, startWidth) {
  return startWidth + (clientX - startX);
}

/** Left edge of a right column: drag left to widen. */
export function widenFromLeftEdge(clientX, startX, startWidth) {
  return startWidth + (startX - clientX);
}
