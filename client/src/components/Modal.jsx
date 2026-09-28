import { X } from 'lucide-react';
import { MODAL_OVERLAY_CLASS, MODAL_PANEL_CLASS, TEXT_FAINT, TEXT_PRIMARY } from '../utils/ui.js';

/**
 * Centered dialog shell. Overlay click is not wired — callers that need it
 * attach their own handler; most confirm modals only close via buttons.
 */
export default function Modal({
  children,
  overlayClassName = '',
  panelClassName = '',
  maxWidth = 'max-w-sm',
  padding = 'p-6',
}) {
  return (
    <div className={`${MODAL_OVERLAY_CLASS} ${overlayClassName}`}>
      <div className={`${MODAL_PANEL_CLASS} ${maxWidth} ${padding} ${panelClassName}`}>
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, icon: Icon, onClose, disabled = false }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-2 min-w-0">
        {Icon ? <Icon className="w-4 h-4 shrink-0 text-accent" /> : null}
        <h3 className={`${TEXT_PRIMARY} font-semibold`}>{title}</h3>
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          disabled={disabled}
          className={`${TEXT_FAINT} hover:text-secondary p-1 -m-1 disabled:opacity-50`}
        >
          <X className="w-4 h-4" />
        </button>
      ) : null}
    </div>
  );
}

export function ModalActions({ children, className = 'flex gap-3 justify-end mt-6' }) {
  return <div className={className}>{children}</div>;
}
