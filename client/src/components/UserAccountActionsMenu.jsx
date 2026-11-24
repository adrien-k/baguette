import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';

/**
 * @typedef {{ label: string, onSelect: () => void, disabled?: boolean, title?: string, danger?: boolean }} UserAccountActionItem
 */

/**
 * Row actions menu for Admin → Users (make admin, revoke, invite link, …).
 */
export default function UserAccountActionsMenu({ items, ariaLabel = 'User actions' }) {
  const [open, setOpen] = useState(false);

  if (!items?.length) return null;

  const close = () => setOpen(false);

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      className={`min-w-[11rem] ${DROPDOWN_PANEL_CLASS} overflow-hidden py-1`}
      reference={({ ref, referenceProps }) => (
        <button
          type="button"
          ref={ref}
          {...referenceProps}
          onClick={(e) => {
            referenceProps.onClick?.(e);
            setOpen((v) => !v);
          }}
          title="Actions"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="menu"
          className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-control transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" strokeWidth={2} aria-hidden />
        </button>
      )}
    >
      <div role="menu">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              if (item.disabled) return;
              close();
              item.onSelect();
            }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-control disabled:opacity-50 disabled:cursor-not-allowed ${
              item.danger ? 'text-danger hover:text-danger' : 'text-heading'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </AnchoredMenu>
  );
}
