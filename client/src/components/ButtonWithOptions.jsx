import Tooltip from './Tooltip.jsx';
import ComposerPrimaryMenuAddon from './ComposerPrimaryMenuAddon.jsx';
import {
  SPLIT_BRAND_FILL,
  SPLIT_CHEVRON_CLASS,
  SPLIT_DIVIDER,
  SPLIT_GROUP_CLASS,
  SPLIT_PRIMARY_CLASS,
} from './splitButtonStyles.js';

function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Primary action with an optional caret menu (split button).
 * Brand fill, divider, and rounding are applied internally; pass className /
 * chevronClassName / groupClassName to customize inner layout.
 */
export default function ButtonWithOptions({
  type = 'button',
  disabled = false,
  onClick,
  children,
  options = null,
  menuItems,
  menuTitle = 'More actions',
  menuFooter,
  tooltip = null,
  className = SPLIT_PRIMARY_CLASS,
  chevronClassName = SPLIT_CHEVRON_CLASS,
  groupClassName = SPLIT_GROUP_CLASS,
}) {
  const menuAddon =
    options ??
    (menuItems?.length || menuFooter ? (
      <ComposerPrimaryMenuAddon
        disabled={disabled}
        title={menuTitle}
        items={menuItems ?? []}
        footer={menuFooter}
        className={chevronClassName}
      />
    ) : null);

  const hasMenu = Boolean(menuAddon);
  const primaryClass = joinClasses(
    className,
    hasMenu
      ? `${SPLIT_BRAND_FILL} ${SPLIT_DIVIDER} rounded-l-lg disabled:cursor-not-allowed`
      : 'bg-brand hover:enabled:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand border border-transparent transition-colors disabled:cursor-not-allowed rounded-lg'
  );

  const primary = (
    <button type={type} disabled={disabled} onClick={onClick} className={primaryClass}>
      {children}
    </button>
  );

  if (!hasMenu) {
    return tooltip ? (
      <Tooltip content={tooltip} wrap placement="top-end">
        {primary}
      </Tooltip>
    ) : (
      primary
    );
  }

  return (
    <div className={groupClassName}>
      {tooltip ? (
        <Tooltip content={tooltip} wrap placement="top-end">
          {primary}
        </Tooltip>
      ) : (
        primary
      )}
      {menuAddon}
    </div>
  );
}
