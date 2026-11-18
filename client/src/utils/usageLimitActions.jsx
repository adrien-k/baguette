import { Ban, DollarSign, Moon } from 'lucide-react';

const ICON_CLASS = 'w-3.5 h-3.5';

export const DEFAULT_USAGE_LIMIT_ACTION = 'stop';

/** What an agent does when its subscription limit is reached (options for LightChipDropdown). */
export const USAGE_LIMIT_ACTION_OPTIONS = [
  {
    value: 'stop',
    label: 'Stop',
    description: 'Stops working when a session/weekly/monthly limit is reached',
    icon: <Ban className={ICON_CLASS} aria-hidden />,
  },
  {
    value: 'wait',
    label: 'Wait',
    description: 'Waits for the session/weekly/monthly limit to reset, then continues',
    icon: <Moon className={ICON_CLASS} aria-hidden />,
  },
  {
    value: 'continue',
    label: 'Continue',
    description: 'Ignores the session/weekly/monthly limit and continues using credits',
    icon: <DollarSign className={ICON_CLASS} aria-hidden />,
  },
];

export function usageLimitActionLabel(value) {
  return (
    USAGE_LIMIT_ACTION_OPTIONS.find((o) => o.value === value) ?? USAGE_LIMIT_ACTION_OPTIONS[0]
  ).label;
}

/** Input text for a stored usage limit: null (unlimited) → "", 0.25 → "0.25". */
export function usageLimitInputText(limit) {
  return limit == null ? '' : String(limit);
}

/**
 * Parse the usage-limit input: "" → null (unlimited), "0.25" → 0.25, anything that is not a
 * dollar amount >= 0 → undefined (invalid, do not send).
 */
export function parseUsageLimit(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
