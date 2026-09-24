import { useCursorModelPrefs } from '../hooks/useAgentPreferences.js';

const FAST_OPTIONS = [
  { value: 'default', label: 'Fast: default' },
  { value: 'yes', label: 'Fast: yes' },
  { value: 'no', label: 'Fast: no' },
];

const EFFORT_OPTIONS = [
  { value: 'default', label: 'Effort: default' },
  { value: 'low', label: 'Effort: low' },
  { value: 'medium', label: 'Effort: medium' },
  { value: 'high', label: 'Effort: high' },
  { value: 'xhigh', label: 'Effort: xhigh' },
];

/** Account-wide Cursor model preferences (used when creating sessions and by MCP CreateSession). */
export default function CursorModelPreferencesSection() {
  const { cursorFast, cursorEffort, setCursorFast, setCursorEffort, loaded } =
    useCursorModelPrefs();

  if (!loaded) {
    return <p className="text-xs text-zinc-500">Loading model preferences…</p>;
  }

  return (
    <div className="flex flex-wrap gap-3">
      <label className="text-xs text-zinc-400 flex flex-col gap-1">
        Fast mode
        <select
          value={cursorFast}
          onChange={(e) => setCursorFast(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          {FAST_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-zinc-400 flex flex-col gap-1">
        Effort
        <select
          value={cursorEffort}
          onChange={(e) => setCursorEffort(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          {EFFORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
