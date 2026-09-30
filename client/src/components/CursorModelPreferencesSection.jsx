import { useCursorModelPrefs } from '../hooks/useAgentPreferences.js';
import LightChipDropdown from './LightChipDropdown.jsx';
import {
  ParamPrefClearButton,
  ParamRowLabel,
  ParamToggleSwitch,
} from './ComposerParamControls.jsx';
const TIER_OPTION = (value) => ({ value, label: value });

const EFFORT_OPTIONS = [
  TIER_OPTION('default'),
  TIER_OPTION('low'),
  TIER_OPTION('medium'),
  TIER_OPTION('high'),
  TIER_OPTION('xhigh'),
  TIER_OPTION('max'),
];

const REASONING_OPTIONS = [
  TIER_OPTION('default'),
  TIER_OPTION('none'),
  TIER_OPTION('low'),
  TIER_OPTION('medium'),
  TIER_OPTION('high'),
  TIER_OPTION('xhigh'),
  TIER_OPTION('extra-high'),
  TIER_OPTION('max'),
];

const CONTEXT_OPTIONS = [
  TIER_OPTION('default'),
  TIER_OPTION('200k'),
  TIER_OPTION('272k'),
  TIER_OPTION('300k'),
  TIER_OPTION('1m'),
];

function cycleYesNoPref(current) {
  if (current === 'default') return 'yes';
  if (current === 'yes') return 'no';
  return 'yes';
}

function PrefYesNoRow({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-xs text-secondary">
      <ParamRowLabel label={label} valueLabel={value} />
      <div className="flex shrink-0 items-center gap-1">
        <ParamPrefClearButton
          visible={value !== 'default'}
          ariaLabel={`Reset ${label} to default`}
          onClear={() => onChange('default')}
        />
        <ParamToggleSwitch
          checked={value === 'yes'}
          onToggle={() => onChange(cycleYesNoPref(value))}
        />
      </div>
    </div>
  );
}

function PrefDropdownRow({ label, value, options, onChange, ariaLabel }) {
  const selected = options.find((o) => o.value === value);
  const valueLabel = selected?.label ?? value;
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-xs text-secondary">
      <ParamRowLabel label={label} valueLabel={valueLabel} />
      <LightChipDropdown
        layout="list"
        iconOnly
        value={value}
        onChange={onChange}
        options={options}
        ariaLabel={ariaLabel}
        placement="bottom-end"
        triggerClassName="text-faint hover:text-secondary shrink-0"
      />
    </div>
  );
}

/** Account-wide Cursor model preferences (used when creating sessions and by MCP CreateSession). */
export default function CursorModelPreferencesSection() {
  const {
    cursorFast,
    cursorThinking,
    cursorEffort,
    cursorReasoning,
    cursorContext,
    cursorCyber,
    setCursorFast,
    setCursorThinking,
    setCursorEffort,
    setCursorReasoning,
    setCursorContext,
    setCursorCyber,
    loaded,
  } = useCursorModelPrefs();

  if (!loaded) {
    return <p className="text-xs text-faint">Loading model preferences…</p>;
  }

  return (
    <div
      className="w-full max-w-[15rem] py-1 overflow-visible"
      role="group"
      aria-label="Cursor model preferences"
    >
      <PrefYesNoRow label="Fast" value={cursorFast} onChange={setCursorFast} />
      <PrefYesNoRow label="Thinking" value={cursorThinking} onChange={setCursorThinking} />
      <PrefDropdownRow
        label="Effort"
        value={cursorEffort}
        options={EFFORT_OPTIONS}
        onChange={setCursorEffort}
        ariaLabel="Effort preference"
      />
      <PrefDropdownRow
        label="Reasoning"
        value={cursorReasoning}
        options={REASONING_OPTIONS}
        onChange={setCursorReasoning}
        ariaLabel="Reasoning preference"
      />
      <PrefDropdownRow
        label="Context"
        value={cursorContext}
        options={CONTEXT_OPTIONS}
        onChange={setCursorContext}
        ariaLabel="Context preference"
      />
      <PrefYesNoRow label="Cyber" value={cursorCyber} onChange={setCursorCyber} />
    </div>
  );
}
