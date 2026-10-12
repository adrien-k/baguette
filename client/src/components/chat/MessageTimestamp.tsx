import Tooltip from '../Tooltip.jsx';
import { formatMessageDateTimeTooltip, formatMessageTime } from '../../utils/dates.js';

type MessageTimestampProps = {
  createdAt: string;
  className?: string;
};

/** Inline message time with a tooltip showing the full local date and time. */
export default function MessageTimestamp({ createdAt, className = '' }: MessageTimestampProps) {
  const time = formatMessageTime(createdAt);
  const tooltip = formatMessageDateTimeTooltip(createdAt);
  if (!time) return null;

  return (
    <Tooltip content={tooltip}>
      <span className={className}>{time}</span>
    </Tooltip>
  );
}
