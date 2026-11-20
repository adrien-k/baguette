import TextInput from './TextInput.jsx';

/**
 * Dollar cap for a session's paid credits (empty = unlimited). Plain text state so partial
 * input like "0." is not mangled; callers parse it with `parseUsageLimit`.
 */
export default function UsageLimitInput({ value, onChange, onBlur, disabled = false }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint">
        $
      </span>
      <TextInput
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        placeholder="Unlimited"
        aria-label="Usage limit in dollars"
        className="pl-7"
      />
    </div>
  );
}
