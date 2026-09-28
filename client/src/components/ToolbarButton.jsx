import { forwardRef } from 'react';

const BASE_CLASS =
  'session-tool-btn inline-flex items-center justify-center shrink-0 rounded-md border font-medium transition-colors border-strong/80 bg-control/50 text-secondary hover:border-info/35 hover:bg-info/10 hover:text-info disabled:opacity-50';

const DEFAULT_SIZE = 'h-8 gap-1.5 px-2 text-xs';

/** Container classes for {@link SessionTools} — sizes all `.session-tool-btn` descendants. */
export const SESSION_TOOLS_CONTAINER_CLASS = {
  toolbar: '',
  compact:
    '[&_.session-tool-btn]:h-auto [&_.session-tool-btn]:gap-1 [&_.session-tool-btn]:px-1.5 [&_.session-tool-btn]:py-0.5 [&_.session-tool-btn]:text-[11px]',
};

/**
 * Compact tool control; height/layout for groups use {@link SESSION_TOOLS_CONTAINER_CLASS} on {@link SessionTools}.
 */
const ToolbarButton = forwardRef(function ToolbarButton(
  {
    href,
    icon: Icon,
    label,
    hideLabelBelowSm = false,
    className = '',
    iconClassName = '',
    type = 'button',
    children,
    ...props
  },
  ref
) {
  const classNames = `${BASE_CLASS} ${DEFAULT_SIZE} ${className}`;
  const content = (
    <>
      {Icon ? (
        <Icon className={`w-3 h-3 shrink-0 opacity-90 ${iconClassName}`} aria-hidden />
      ) : null}
      {label != null && label !== '' && (
        <span className={hideLabelBelowSm ? 'hidden sm:inline' : undefined}>{label}</span>
      )}
      {children}
    </>
  );

  if (href) {
    return (
      <a
        ref={ref}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classNames}
        {...props}
      >
        {content}
      </a>
    );
  }

  return (
    <button ref={ref} type={type} className={classNames} {...props}>
      {content}
    </button>
  );
});

export default ToolbarButton;
