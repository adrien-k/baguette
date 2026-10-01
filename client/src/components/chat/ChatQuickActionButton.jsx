import Tooltip from '../Tooltip.jsx';

export const CHAT_ACTION_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 bg-control hover:bg-control-hover border border-strong rounded-lg text-xs text-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** Small chat quick-action control with an optional tooltip. */
export default function ChatQuickActionButton({
  icon: Icon,
  label,
  tooltip,
  onClick,
  disabled = false,
  className = CHAT_ACTION_BUTTON_CLASS,
  children,
}) {
  const button = (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden /> : null}
      {label}
      {children}
    </button>
  );

  if (!tooltip) return button;
  return <Tooltip content={tooltip}>{button}</Tooltip>;
}
