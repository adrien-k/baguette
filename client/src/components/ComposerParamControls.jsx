import Toggle from './Toggle.jsx';

/** Shared param row label + toggle (composer menu and Agent settings). */
export function ParamRowLabel({ label, valueLabel, onValueClick }) {
  return (
    <span className="flex min-w-0 flex-1 items-center">
      <span className="shrink-0 text-faint">{label}:</span>
      <span
        className={`text-heading truncate pl-1 ${onValueClick ? 'cursor-pointer hover:text-white' : ''}`}
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
    <Toggle
      checked={checked}
      disabled={disabled}
      onChange={() => onToggle()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
