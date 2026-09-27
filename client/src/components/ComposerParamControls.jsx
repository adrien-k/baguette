/** Shared param row label + toggle (composer menu and Agent settings). */
export function ParamRowLabel({ label, valueLabel, onValueClick }) {
  return (
    <span className="flex min-w-0 flex-1 items-center">
      <span className="shrink-0 text-zinc-500">{label}:</span>
      <span
        className={`text-zinc-200 truncate pl-1 ${onValueClick ? 'cursor-pointer hover:text-white' : ''}`}
        onClick={onValueClick}
        onKeyDown={
          onValueClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onValueClick();
                }
              }
            : undefined
        }
        role={onValueClick ? 'button' : undefined}
        tabIndex={onValueClick ? 0 : undefined}
      >
        {valueLabel}
      </span>
    </span>
  );
}

export function ParamToggleSwitch({ checked, disabled, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:opacity-50 ${
        checked ? 'bg-amber-500' : 'bg-zinc-600'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
