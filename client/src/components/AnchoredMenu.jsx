import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
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
}) {
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
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
