import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
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

  const triggerLabel = () => {
    if (!selected.length) return 'None';
    if (selected.length === 1) return selected[0];
    return `${selected.length} skills selected`;
  };

  const toggle = (label) => {
    if (selected.includes(label)) {
      onChange(selected.filter((l) => l !== label));
    } else {
      onChange([...selected, label]);
    }
  };

  const close = () => {
    setOpen(false);
    setFilter('');
  };

  return (
    <AnchoredMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else setOpen(true);
      }}
      placement="bottom-start"
      matchReferenceWidth
      className={`max-h-72 overflow-y-auto ${DROPDOWN_PANEL_CLASS}`}
      reference={({ ref, referenceProps }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled || skills.length === 0}
          {...referenceProps}
          className={`${INPUT_CLASS} flex w-full items-center justify-between gap-2 text-left focus:border-transparent disabled:cursor-not-allowed`}
        >
          <span className={`truncate ${selected.length ? 'text-fg' : 'text-faint'}`}>
            {triggerLabel()}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        </button>
      )}
    >
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-2 py-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search skills…"
          className="w-full rounded-md border border-strong bg-control px-2.5 py-1.5 text-sm text-fg placeholder-faint focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand/50"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="px-3 py-2.5 text-sm text-faint">No skills match</p>
      ) : (
        filtered.map((skill) => {
          const isSelected = selected.includes(skill.label);
          return (
            <button
              key={skill.label}
              type="button"
              onClick={() => toggle(skill.label)}
              className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-control/50"
            >
              <Check
                className={`mt-0.5 h-4 w-4 shrink-0 ${isSelected ? 'text-accent' : 'opacity-0'}`}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="font-medium text-heading">{skill.label}</span>
                <span className="mt-0.5 block text-xs text-faint">
                  {skill.source}
                  {skill.description ? ` · ${skill.description}` : ''}
                </span>
              </span>
            </button>
          );
        })
      )}
    </AnchoredMenu>
  );
}
