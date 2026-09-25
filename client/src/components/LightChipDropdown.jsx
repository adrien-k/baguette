import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';

/** Chip button styles shared with session model / variant pickers. */
export function chipOptionClassName(selected) {
  return `px-2.5 py-1 rounded text-xs transition-colors border disabled:opacity-50 ${
    selected
      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
  }`;
}

export function listOptionClassName(selected) {
  return `w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
    selected ? 'text-white bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
  }`;
}

export const lightChipPanelClassName =
  'max-w-[min(100vw-2rem,20rem)] max-h-72 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2.5';

export const lightListPanelClassName =
  'min-w-[14rem] max-w-[min(100vw-2rem,18rem)] max-h-[min(24rem,70vh)] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1';

/**
 * @typedef {{ value: string, label: string, icon?: import('react').ReactNode }} LightDropdownOption
 * @typedef {{ heading?: string, options: LightDropdownOption[] }} LightDropdownSection
 */

function optionKey(value) {
  return value === '' ? '__empty__' : value;
}

/**
 * Compact trigger + floating menu (chips or vertical list).
 *
 * @param {LightDropdownOption[]} [options]
 * @param {LightDropdownSection[]} [sections]
 */
export default function LightChipDropdown({
  value,
  onChange,
  options = [],
  sections,
  footer,
  layout = 'chips',
  label,
  description,
  disabled = false,
  id,
  ariaLabel = 'Choose option',
  placement = 'bottom-start',
  triggerTitle,
  panelClassName,
  triggerClassName = '',
  fullWidth = false,
  /** Override trigger when `value` is not in the option list */
  selectedDisplay,
  /** Show only `triggerIcon` (no label text) */
  iconOnly = false,
  hideChevron = false,
}) {
  const [open, setOpen] = useState(false);
  const flatOptions = sections ? sections.flatMap((s) => s.options) : options;
  const selected = flatOptions.find((o) => o.value === value);
  const triggerLabel = selectedDisplay?.label ?? selected?.label ?? 'Select';
  const triggerIcon = selectedDisplay?.icon ?? selected?.icon;

  const resolvedPanelClassName =
    panelClassName ?? (layout === 'list' ? lightListPanelClassName : lightChipPanelClassName);

  const pick = (next) => {
    onChange(next);
    setOpen(false);
  };

  const renderOption = (opt) => (
    <button
      key={optionKey(opt.value)}
      type="button"
      disabled={disabled}
      onClick={() => pick(opt.value)}
      className={
        layout === 'list'
          ? listOptionClassName(opt.value === value)
          : chipOptionClassName(opt.value === value)
      }
    >
      {opt.icon ? <span className="shrink-0 flex items-center">{opt.icon}</span> : null}
      <span className={layout === 'list' ? 'truncate flex-1 min-w-0' : ''}>{opt.label}</span>
      {layout === 'list' && opt.detail ? (
        <span className="ml-auto text-xs text-zinc-500 shrink-0">{opt.detail}</span>
      ) : null}
    </button>
  );

  const triggerBase =
    layout === 'list'
      ? 'text-sm text-zinc-300 hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none'
      : 'text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:pointer-events-none';

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label ? (
        <span
          id={id ? `${id}-label` : undefined}
          className="block text-sm font-medium text-zinc-300 mb-1"
        >
          {label}
        </span>
      ) : null}
      <AnchoredMenu
        open={open && !disabled}
        onOpenChange={setOpen}
        placement={placement}
        className={resolvedPanelClassName}
        reference={({ ref, referenceProps }) => (
          <button
            type="button"
            ref={ref}
            id={id}
            {...referenceProps}
            disabled={disabled}
            onClick={(e) => {
              referenceProps.onClick?.(e);
              if (!disabled) setOpen((v) => !v);
            }}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-labelledby={label && id ? `${id}-label` : undefined}
            title={triggerTitle ?? triggerLabel}
            className={`${triggerBase} ${fullWidth ? 'w-full max-w-none justify-between' : 'max-w-full sm:max-w-md'} ${triggerClassName}`}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              {triggerIcon ? (
                <span className="shrink-0 flex items-center">{triggerIcon}</span>
              ) : null}
              {!iconOnly ? <span className="truncate">{triggerLabel}</span> : null}
            </span>
            {!hideChevron ? (
              <ChevronDown
                className={`w-3 h-3 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
                strokeWidth={2.5}
              />
            ) : null}
          </button>
        )}
      >
        <div
          role="dialog"
          aria-label={ariaLabel}
          className={layout === 'list' ? 'flex flex-col' : 'flex flex-wrap gap-1.5'}
        >
          {sections
            ? sections.map((section, i) => (
                <div key={section.heading ?? i}>
                  {section.heading ? (
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      {section.heading}
                    </div>
                  ) : i > 0 ? (
                    <div className="border-t border-zinc-700 my-1" />
                  ) : null}
                  {section.options.map(renderOption)}
                </div>
              ))
            : options.map(renderOption)}
          {footer ? <div className="border-t border-zinc-700 mt-1 pt-1">{footer}</div> : null}
        </div>
      </AnchoredMenu>
      {description ? <p className="mt-1 text-xs text-zinc-500">{description}</p> : null}
    </div>
  );
}
