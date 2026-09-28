/**
 * Shared dashboard card shell for sessions, loops, and similar list rows.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.repo]
 * @param {import('react').ReactNode} [props.indicator] — left-column status icon, aligned with the title
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.subtitle] — e.g. last activity
 * @param {import('react').ReactNode} [props.titleExtras] — badges beside the title row
 * @param {import('react').ReactNode} [props.description]
 * @param {string} [props.accentClassName] — left border color (Tailwind `border-l-*`)
 * @param {string} [props.className]
 * @param {boolean} [props.dimmed]
 * @param {() => void} [props.onClick]
 * @param {Array<{ icon?: import('lucide-react').LucideIcon, onClick?: (e: import('react').MouseEvent) => void, title?: string, disabled?: boolean, node?: import('react').ReactNode, className?: string, key?: string }>} [props.actions]
 * @param {import('react').ReactNode} [props.controls] — footer toolbar (tools, loop toggle, schedule)
 */
export default function SessionCardLayout({
  repo,
  indicator,
  title,
  subtitle,
  titleExtras,
  description,
  accentClassName = 'border-l-strong',
  className = '',
  dimmed = false,
  onClick,
  actions = [],
  controls,
}) {
  const interactive = typeof onClick === 'function';

  const actionButtons =
    actions.length > 0 ? (
      <div
        className="flex items-center gap-1.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {actions.map((action, i) => {
          if (action.node != null) {
            return <span key={action.key ?? i}>{action.node}</span>;
          }
          const Icon = action.icon;
          if (!Icon || !action.onClick) return null;
          return (
            <button
              key={action.key ?? i}
              type="button"
              onClick={action.onClick}
              title={action.title}
              disabled={action.disabled}
              className={
                action.className ??
                'p-1 text-faint hover:text-accent hover:bg-control rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              }
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div
      onClick={onClick}
      className={`w-full min-w-0 bg-nav border border-line rounded-lg p-3 sm:p-4 border-l-2 transition-colors ${accentClassName} ${
        interactive ? 'cursor-pointer hover:border-strong active:bg-control/50' : ''
      } ${dimmed ? 'opacity-50' : ''} ${className}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        {indicator != null ? (
          <span className="shrink-0 cursor-default inline-flex items-center text-sm leading-snug h-[1lh]">
            {indicator}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 max-w-full flex-1">
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 max-w-full">
                <span className="text-fg font-medium text-sm leading-snug truncate min-w-0 max-w-full flex-1">
                  {title}
                </span>
                {titleExtras ? (
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    {titleExtras}
                  </span>
                ) : null}
              </span>
              {subtitle ? <span className="text-faint text-xs shrink-0">{subtitle}</span> : null}
            </div>
            {actionButtons}
          </div>

          {description ? <div className="mt-2 w-full min-w-0">{description}</div> : null}

          {controls || repo ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 w-full min-w-0">
              {controls ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">{controls}</div>
              ) : null}
              {repo ? <div className="min-w-0 flex-1 overflow-hidden">{repo}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
