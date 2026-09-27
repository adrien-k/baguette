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
} from '@floating-ui/react';

export default function Tooltip({ children, content, placement = 'top', wrap = false }) {
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

  const hover = useHover(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);

  return (
    <>
      <span ref={setReference} {...getReferenceProps()} className="inline-flex items-stretch">
        {children}
      </span>
      <FloatingPortal>
        <div
          ref={setFloating}
          style={{ ...floatingStyles, display: open ? undefined : 'none' }}
          {...getFloatingProps()}
          className={`z-[9999] px-2 py-1 bg-zinc-700 text-zinc-200 text-xs rounded pointer-events-none ${
            wrap ? 'max-w-[240px] whitespace-normal' : 'whitespace-nowrap'
          }`}
        >
          {content}
        </div>
      </FloatingPortal>
    </>
  );
}
