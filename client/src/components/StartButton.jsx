import { Play } from 'lucide-react';
import { NEUTRAL_BUTTON_CLASS, NEUTRAL_BUTTON_PLAY_ICON_CLASS } from '../utils/buttonStyles.js';

/** Neutral run/start control (task shortcuts, preview services, etc.). */
export default function StartButton({
  children = 'Start',
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button type={type} className={`${NEUTRAL_BUTTON_CLASS} ${className}`.trim()} {...props}>
      <Play className={NEUTRAL_BUTTON_PLAY_ICON_CLASS} />
      {children}
    </button>
  );
}
