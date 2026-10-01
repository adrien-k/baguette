import { Play } from 'lucide-react';
import {
  NEUTRAL_BUTTON_CLASS,
  NEUTRAL_BUTTON_COMPACT_CLASS,
  NEUTRAL_BUTTON_PLAY_ICON_CLASS,
  NEUTRAL_BUTTON_PLAY_ICON_COMPACT_CLASS,
} from '../utils/buttonStyles.js';

/** Neutral run/start control (task shortcuts, preview services, etc.). */
export default function StartButton({
  children = 'Start',
  className = '',
  compact = false,
  type = 'button',
  ...props
}) {
  const buttonClass = compact ? NEUTRAL_BUTTON_COMPACT_CLASS : NEUTRAL_BUTTON_CLASS;
  const iconClass = compact
    ? NEUTRAL_BUTTON_PLAY_ICON_COMPACT_CLASS
    : NEUTRAL_BUTTON_PLAY_ICON_CLASS;
  return (
    <button type={type} className={`${buttonClass} ${className}`.trim()} {...props}>
      <Play className={iconClass} />
      {children}
    </button>
  );
}
