import { TOGGLE_TRACK_OFF } from '../utils/ui.js';

const SIZES = {
  sm: {
    track: 'h-4 w-7',
    knob: 'h-3 w-3',
    on: 'translate-x-3.5',
    off: 'translate-x-0.5',
  },
  md: {
    track: 'h-5 w-9',
    knob: 'h-4 w-4',
    on: 'translate-x-4.5',
    off: 'translate-x-0.5',
  },
};

/**
 * Switch control: track + knob, `role="switch"`.
 */
export default function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  title,
  size = 'sm',
  className = '',
  onClick,
  ...props
}) {
  const dim = SIZES[size] ?? SIZES.sm;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        onChange(!checked);
      }}
      className={`flex items-center gap-1.5 shrink-0 group disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      <span
        className={`relative inline-flex ${dim.track} shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-brand' : TOGGLE_TRACK_OFF
        }`}
      >
        <span
          className={`inline-block ${dim.knob} rounded-full bg-knob shadow transition-transform ${
            checked ? dim.on : dim.off
          }`}
        />
      </span>
      {label ? (
        <span
          className={`text-xs transition-colors ${
            checked ? 'text-accent' : 'text-faint group-hover:text-secondary'
          }`}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
}
