const ROW_HOVER_REVEAL =
  'md:opacity-0 md:pointer-events-none md:transition-opacity md:group-hover/row:pointer-events-auto md:group-hover/row:opacity-100 md:focus-within:pointer-events-auto md:focus-within:opacity-100';

const GROUP_HOVER_REVEAL =
  'md:opacity-0 md:pointer-events-none md:transition-opacity md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:focus-within:pointer-events-auto md:focus-within:opacity-100';

function revealClass(groupName, forceVisible) {
  if (forceVisible) return '';
  if (groupName === 'row') return ROW_HOVER_REVEAL;
  return GROUP_HOVER_REVEAL;
}

/**
 * Opaque copy of the pixels behind the buttons, faded on the left.
 * Unselected sessions hover with `bg-control/50` over the nav rail. The selected
 * session shell is `bg-control-hover`. `extraHoverWash` adds the agent-row
 * `bg-control/50` hover used when that row is not the open agent.
 */
function TrailingHoverBackdrop({ sessionHighlighted, extraHoverWash }) {
  let base = (
    <>
      <span className="absolute inset-0 bg-nav" />
      <span className="absolute inset-0 bg-control/50" />
    </>
  );
  if (sessionHighlighted) {
    base = <span className="absolute inset-0 bg-control-hover" />;
  }
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 hidden md:block [mask-image:linear-gradient(to_right,transparent,black_0.75rem)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_0.75rem)]"
    >
      {base}
      {extraHoverWash ? <span className="absolute inset-0 bg-control/50" /> : null}
    </span>
  );
}

/**
 * Trailing label with actions over its right edge on desktop hover.
 * Mobile hides the label when actions are present and keeps those actions in flow.
 *
 * @param {'row' | 'group'} groupName — `row` listens to `group/row`, `group` to `group`.
 */
export default function TrailingHoverActions({
  label = null,
  children = null,
  sessionHighlighted = false,
  extraHoverWash = false,
  groupName = 'row',
  forceVisible = false,
  hideLabelOnMobile = true,
  className = '',
}) {
  const hasActions = children != null;
  let labelVisibility = 'flex';
  if (hideLabelOnMobile) labelVisibility = 'hidden md:flex';
  const positionClass = hasActions
    ? 'md:absolute md:right-0 md:top-1/2 md:z-[1] md:-translate-y-1/2'
    : '';

  return (
    <div className={`relative flex items-center justify-end ${className}`}>
      {label ? (
        <div className={`min-w-0 items-center justify-end ${labelVisibility}`}>{label}</div>
      ) : null}
      {hasActions ? (
        <div
          className={`relative flex items-center justify-end gap-1 px-1 md:py-0.5 md:pl-3 md:pr-1 ${positionClass} ${revealClass(
            groupName,
            forceVisible
          )}`}
        >
          <TrailingHoverBackdrop
            sessionHighlighted={sessionHighlighted}
            extraHoverWash={extraHoverWash}
          />
          {children}
        </div>
      ) : null}
    </div>
  );
}
