import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';
import { COMPOSER_ACTION_BUTTON_LAYOUT } from './AgentMessageComposer.jsx';

const DELAY_PRESETS = [
  { label: 'Send in 30 minutes', delayMs: 30 * 60_000 },
  { label: 'Send in 1 hour', delayMs: 3_600_000 },
  { label: 'Send in 2 hours', delayMs: 2 * 3_600_000 },
  { label: 'Send in 4 hours', delayMs: 4 * 3_600_000 },
];

/**
 * Chevron next to Send that queues a delayed send (and optional extra menu items).
 */
export default function ComposerScheduleAddon({
  disabled,
  onPreset,
  onCustomSchedule,
  extraItems,
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      placement="top-end"
      className={`w-44 ${DROPDOWN_PANEL_CLASS} overflow-hidden py-1`}
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
          title="Schedule"
          aria-expanded={open}
          aria-haspopup="menu"
          className={`${COMPOSER_ACTION_BUTTON_LAYOUT} bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 border border-transparent px-1.5 rounded-r-lg transition-colors disabled:cursor-not-allowed`}
        >
          <ChevronDown className="w-3 h-3" strokeWidth={2.5} />
        </button>
      )}
    >
      <div role="menu">
        {DELAY_PRESETS.map(({ label, delayMs }) => (
          <button
            key={delayMs}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onPreset(delayMs);
            }}
            className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onCustomSchedule();
          }}
          className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
        >
          Schedule
        </button>
        {extraItems ? <div onClick={() => setOpen(false)}>{extraItems}</div> : null}
      </div>
    </AnchoredMenu>
  );
}
