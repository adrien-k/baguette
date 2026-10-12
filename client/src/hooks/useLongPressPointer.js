import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_DELAY_MS = 500;
const DEFAULT_MOVE_TOLERANCE_PX = 12;

/**
 * Pointer long-press for touch (and other non-mouse pointers). Ignores mouse by default.
 *
 * @param {{
 *   enabled?: boolean;
 *   onLongPress: () => void;
 *   delayMs?: number;
 *   moveTolerancePx?: number;
 *   touchOnly?: boolean;
 *   ignoreButtonTargets?: boolean;
 * }} options
 */
export function useLongPressPointer({
  enabled = true,
  onLongPress,
  delayMs = DEFAULT_DELAY_MS,
  moveTolerancePx = DEFAULT_MOVE_TOLERANCE_PX,
  touchOnly = true,
  ignoreButtonTargets = true,
}) {
  const onLongPressRef = useRef(onLongPress);
  const timerRef = useRef(null);
  const pointerIdRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pointerIdRef.current = null;
  }, []);

  useEffect(() => () => clear(), [clear]);

  const onPointerDown = useCallback(
    (e) => {
      if (!enabled) return;
      if (touchOnly && e.pointerType === 'mouse') return;
      if (e.button !== 0) return;
      if (ignoreButtonTargets && e.target.closest('button')) return;
      clear();
      pointerIdRef.current = e.pointerId;
      startRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pointerIdRef.current = null;
        onLongPressRef.current();
      }, delayMs);
    },
    [clear, delayMs, enabled, ignoreButtonTargets, touchOnly]
  );

  const onPointerMove = useCallback(
    (e) => {
      if (pointerIdRef.current !== e.pointerId) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      const tol = moveTolerancePx;
      if (dx * dx + dy * dy > tol * tol) clear();
    },
    [clear, moveTolerancePx]
  );

  const onPointerUp = useCallback(
    (e) => {
      if (pointerIdRef.current === e.pointerId) clear();
    },
    [clear]
  );

  const onContextMenu = useCallback(
    (e) => {
      if (enabled) e.preventDefault();
    },
    [enabled]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: clear,
    onContextMenu,
  };
}
