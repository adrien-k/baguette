import ComposerPrimaryMenuAddon from './ComposerPrimaryMenuAddon.jsx';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';

const DELAY_PRESETS = [
  { label: 'Send in 30 minutes', delayMs: 30 * 60_000 },
  { label: 'Send in 1 hour', delayMs: 3_600_000 },
  { label: 'Send in 2 hours', delayMs: 2 * 3_600_000 },
  { label: 'Send in 4 hours', delayMs: 4 * 3_600_000 },
];

/**
 * Chevron next to Send that queues a delayed send (and optional extra menu items).
 */
export default function ComposerScheduleAddon({
  disabled,
  onPreset,
  onCustomSchedule,
  onSendNow,
  extraItems,
}) {
  const items = [
    ...(onSendNow ? [{ label: 'Send now', onSelect: onSendNow }] : []),
    ...DELAY_PRESETS.map(({ label, delayMs }) => ({
      label,
      onSelect: () => onPreset(delayMs),
    })),
    { label: 'Schedule', onSelect: onCustomSchedule },
  ];

  return (
    <ComposerPrimaryMenuAddon
      disabled={disabled}
      title="Schedule"
      panelClassName={`w-44 ${DROPDOWN_PANEL_CLASS} overflow-hidden py-1`}
      items={items}
      footer={extraItems}
    />
  );
}
