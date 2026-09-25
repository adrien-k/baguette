/**
 * Switch control: track + knob, `role="switch"`.
 */
export default function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  title,
  className = '',
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-1.5 shrink-0 group disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <span
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-amber-500' : 'bg-zinc-600'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
      {label ? (
        <span
          className={`text-xs transition-colors ${
            checked ? 'text-amber-400' : 'text-zinc-500 group-hover:text-zinc-300'
          }`}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
}
