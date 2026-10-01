import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';
import { SPLIT_BRAND_FILL, SPLIT_CHEVRON_CLASS } from './splitButtonStyles.js';

/**
 * @typedef {{ label: string, subtitle?: string, hint?: string, onSelect: () => void, disabled?: boolean, selected?: boolean }} ComposerMenuItem
 */

/**
 * Split-button caret that opens a menu of alternate primary actions (schedule presets, Plan, Continue, …).
 */
export default function ComposerPrimaryMenuAddon({
  disabled = false,
  title = 'More actions',
  panelClassName = `w-56 ${DROPDOWN_PANEL_CLASS} overflow-hidden py-1`,
  items = [],
  footer,
  className = SPLIT_CHEVRON_CLASS,
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = () => setOpen(false);

  if (!items.length && !footer) return null;

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      placement="top-end"
      className={panelClassName}
      reference={({ ref, referenceProps }) => (
        <button
          type="button"
          ref={ref}
          {...referenceProps}
          disabled={disabled}
          onClick={(e) => {
            referenceProps.onClick?.(e);
            if (!disabled) setOpen((v) => !v);
          }}
          title={title}
          aria-expanded={open}
          aria-haspopup="menu"
          className={`${className} ${SPLIT_BRAND_FILL} border border-transparent px-1.5 rounded-r-lg disabled:cursor-not-allowed`}
        >
          <ChevronDown className="w-3 h-3" strokeWidth={2.5} />
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
            onClick={() => {
              if (item.disabled) return;
              close();
              item.onSelect();
            }}
            className={`w-full text-left px-3 py-2 text-sm text-heading hover:bg-control disabled:opacity-50 disabled:cursor-not-allowed ${
              item.selected ? 'bg-control' : ''
            }`}
          >
            <span className="block">{item.label}</span>
            {item.subtitle ? (
              <span className="block text-[10px] text-faint font-normal mt-0.5 leading-none whitespace-nowrap">
                {item.subtitle}
              </span>
            ) : null}
            {item.hint ? (
              <span className="block text-xs text-faint font-normal mt-0.5 leading-snug">
                {item.hint}
              </span>
            ) : null}
          </button>
        ))}
        {footer ? (
          <div
            onClick={(e) => {
              if (e.target.closest('[role="menuitem"]')) close();
            }}
          >
            {typeof footer === 'function' ? footer(close) : footer}
          </div>
        ) : null}
      </div>
    </AnchoredMenu>
  );
}
