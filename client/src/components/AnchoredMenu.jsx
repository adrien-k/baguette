/* eslint-disable react-hooks/refs -- @floating-ui callback refs (setReference/setFloating) */
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';

/**
 * Fixed-position panel portaled to document.body (avoids overflow-hidden ancestors).
 */
export default function AnchoredMenu({
  open,
  onOpenChange,
  placement = 'top-end',
  reference,
  children,
  className = '',
  matchReferenceWidth = false,
}) {
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
      ...(matchReferenceWidth
        ? [
            size({
              apply({ rects, elements }) {
                Object.assign(elements.floating.style, { width: `${rects.reference.width}px` });
              },
            }),
          ]
        : []),
    ],
  });

  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  return (
    <>
      {reference({ ref: refs.setReference, referenceProps: getReferenceProps() })}
      <FloatingPortal>
        {open && (
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className={`z-[9999] ${className}`}
          >
            {children}
          </div>
        )}
      </FloatingPortal>
    </>
  );
}
