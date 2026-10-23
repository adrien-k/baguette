import { Archive, Repeat } from 'lucide-react';
import { useFilters } from '../context/FilterContext.jsx';

function FilterToggle({ icon: Icon, label, checked, onChange }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onChange}
      className="flex items-center gap-2 rounded-md border border-strong bg-nav/80 px-2 py-1 text-[11px] text-secondary hover:bg-control/80 hover:text-fg transition-colors w-full"
    >
      <Icon className="w-3.5 h-3.5 text-faint shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      <span
        className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${checked ? 'bg-brand' : 'bg-track'}`}
        aria-hidden
      >
        <span
          className={`w-3 h-3 rounded-full bg-knob shadow transition-transform ${checked ? 'translate-x-3' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );
}

export default function SessionListFilters() {
  const { showArchived, setShowArchived, showLoopRuns, setShowLoopRuns } = useFilters();

  return (
    <div className="shrink-0 px-2 py-2 border-t border-line space-y-1.5">
      <FilterToggle
        icon={Repeat}
        label="Show loop runs"
        checked={showLoopRuns}
        onChange={() => setShowLoopRuns(!showLoopRuns)}
      />
      <FilterToggle
        icon={Archive}
        label="Show archived"
        checked={showArchived}
        onChange={() => setShowArchived(!showArchived)}
      />
    </div>
  );
}
