import { useState } from 'react';
import {
  useFloating,
  useHover,
  useInteractions,
  FloatingPortal,
  offset,
  flip,
  shift,
  autoUpdate,
  safePolygon,
} from '@floating-ui/react';

/**
 * @param {boolean} [wrap] — multiline body
 * @param {boolean} [wide] — wider panel (with `wrap`)
 * @param {boolean} [interactive] — links and copy in the panel (hover bridge to the tooltip)
 */
export default function Tooltip({
  children,
  content,
  placement = 'top',
  wrap = false,
  wide = false,
  interactive = false,
  /** Classes for the wrapper around `children`; use `flex w-full` to fill a row. */
  className = 'inline-flex items-stretch',
  /** Fires on the reference target (merged with hover handlers). */
  onReferenceClick,
}) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });
  const { setReference, setFloating } = refs;

  const hover = useHover(
    context,
    interactive ? { move: false, handleClose: safePolygon({ buffer: 4 }) } : undefined
  );
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);
  const referenceProps = getReferenceProps(
    onReferenceClick ? { onClick: onReferenceClick } : undefined
  );

  let panelSizeClass = 'px-2 py-1 whitespace-nowrap';
  if (wrap && wide) {
    panelSizeClass = 'max-w-sm px-3 py-2 whitespace-normal';
  } else if (wrap) {
    panelSizeClass = 'max-w-[240px] px-2 py-1 whitespace-normal';
  }

  return (
    <>
      <span ref={setReference} {...referenceProps} className={className}>
        {children}
      </span>
      <FloatingPortal>
        <div
          ref={setFloating}
          style={{ ...floatingStyles, display: open ? undefined : 'none' }}
          {...getFloatingProps()}
          className={`z-[9999] rounded border border-line bg-control-hover text-heading text-xs shadow-md ${panelSizeClass} ${
            interactive ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          {content}
        </div>
      </FloatingPortal>
    </>
  );
}
