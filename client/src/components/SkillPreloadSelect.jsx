import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';
import { INPUT_CLASS } from '../utils/ui.js';

/**
 * Multi-select dropdown for preloading skills onto a session or loop.
 */
export default function SkillPreloadSelect({ skills, value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const selected = Array.isArray(value) ? value : [];
  const count = selected.length;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.label?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.source?.toLowerCase().includes(q)
    );
  }, [skills, filter]);

  const toggle = (label) => {
    if (selected.includes(label)) {
      onChange(selected.filter((l) => l !== label));
    } else {
      onChange([...selected, label]);
    }
  };

  const panelDisabled = disabled || skills.length === 0;

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFilter('');
      }}
      placement="bottom-start"
      matchReferenceWidth
      className={`max-h-72 overflow-hidden flex flex-col ${DROPDOWN_PANEL_CLASS}`}
      reference={({ ref, referenceProps }) => (
        <button
          type="button"
          ref={ref}
          disabled={panelDisabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          {...referenceProps}
          onClick={(e) => {
            referenceProps.onClick?.(e);
            if (!panelDisabled) setOpen((v) => !v);
          }}
          className={`${INPUT_CLASS} flex w-full items-center gap-2.5 text-left focus:border-transparent disabled:cursor-not-allowed`}
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
              count > 0
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-strong/80 bg-control/60 text-faint'
            }`}
          >
            {count > 0 ? (
              <span className="text-xs font-semibold tabular-nums leading-none">{count}</span>
            ) : (
              <BookOpen className="h-4 w-4" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {count === 0 ? (
              <span className="text-faint">Select skills to preload</span>
            ) : count === 1 ? (
              <span className="text-fg">{selected[0]}</span>
            ) : (
              <span className="text-fg">
                <span className="font-medium">{count}</span>
                <span className="text-secondary"> skills selected</span>
              </span>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
      )}
    >
      <div className="border-b border-line px-2 py-2 shrink-0">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search skills…"
          className="w-full rounded-md border border-strong bg-control px-2.5 py-1.5 text-sm text-fg placeholder-faint focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand/50"
        />
      </div>
      <div role="listbox" aria-multiselectable="true" className="overflow-y-auto flex-1 min-h-0">
        {filtered.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-faint">No skills match</p>
        ) : (
          filtered.map((skill) => {
            const isSelected = selected.includes(skill.label);
            const optionId = `preload-skill-${skill.label.replace(/\s+/g, '-')}`;
            return (
              <label
                key={skill.label}
                htmlFor={optionId}
                className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-control/50"
              >
                <input
                  id={optionId}
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(skill.label)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-strong text-accent focus:ring-brand/50"
                />
                <span className="min-w-0 select-none">
                  <span className="font-medium text-heading">{skill.label}</span>
                  <span className="mt-0.5 block text-xs text-faint">
                    {skill.source}
                    {skill.description ? ` · ${skill.description}` : ''}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </div>
    </AnchoredMenu>
  );
}
