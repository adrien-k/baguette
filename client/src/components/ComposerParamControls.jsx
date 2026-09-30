import { X } from 'lucide-react';
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

export function ParamToggleSwitch({ checked, disabled, onToggle, ariaLabel }) {
  return (
    <Toggle
      checked={checked}
      disabled={disabled}
      onChange={() => onToggle()}
      onClick={(e) => e.stopPropagation()}
      label={ariaLabel}
    />
  );
}

/** Resets a preference param to default; keeps row width stable when hidden. */
export function ParamPrefClearButton({ onClear, ariaLabel, visible = true }) {
  if (!visible) {
    return <span className="w-5 shrink-0" aria-hidden />;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-control/80 hover:text-secondary"
      aria-label={ariaLabel}
      title="Reset to default"
    >
      <X className="h-3 w-3" />
    </button>
  );
}
