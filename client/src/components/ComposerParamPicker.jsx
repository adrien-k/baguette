import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Settings, ChevronRight } from 'lucide-react';
import AnchoredMenu from './AnchoredMenu.jsx';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';
import { binaryParamToggleOn, binaryParamToggledValue } from '../utils/models.js';
import { ParamRowLabel, ParamToggleSwitch } from './ComposerParamControls.jsx';

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   currentValue: string;
 *   valueLabel: string;
 *   options: { value: string; label: string }[];
 *   onSelect: (value: string) => void;
 *   kind?: 'toggle' | 'menu';
 * }} ComposerParamPickerItem
 */

const SUBMENU_MIN_WIDTH_PX = 120;
const VIEWPORT_PAD_PX = 8;
const SUBMENU_GAP_PX = 4;

/**
 * @param {boolean} open
 * @param {import('react').RefObject<HTMLElement | null>} anchorRef
 * @param {number} optionCount
 */
function useSubmenuPlacement(open, anchorRef, optionCount) {
  const panelRef = useRef(null);
  const [placement, setPlacement] = useState({ side: 'right', top: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;

    const update = () => {
      const anchorEl = anchorRef.current;
      const panelEl = panelRef.current;
      if (!anchorEl || !panelEl) return;

      const anchor = anchorEl.getBoundingClientRect();
      const panel = panelEl.getBoundingClientRect();
      const panelWidth = panel.width || SUBMENU_MIN_WIDTH_PX;
      const panelHeight = panel.height;

      const spaceRight = window.innerWidth - anchor.right - SUBMENU_GAP_PX;
      const spaceLeft = anchor.left - SUBMENU_GAP_PX;
      const needW = panelWidth + VIEWPORT_PAD_PX;
      let side = 'right';
      if (spaceRight < needW && spaceLeft >= needW) {
        side = 'left';
      } else if (spaceRight < needW && spaceLeft > spaceRight) {
        side = 'left';
      }

      const bottomLimit = window.innerHeight - VIEWPORT_PAD_PX;
      const topLimit = VIEWPORT_PAD_PX;
      let top = 0;
      if (panelHeight > 0) {
        if (anchor.top + panelHeight > bottomLimit) {
          top = bottomLimit - panelHeight - anchor.top;
        }
        if (anchor.top + top < topLimit) {
          top = topLimit - anchor.top;
        }
      }

      setPlacement((prev) => (prev.side === side && prev.top === top ? prev : { side, top }));
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, optionCount]);

  return { placement, panelRef };
}

/**
 * @param {{
 *   item: ComposerParamPickerItem;
 *   submenuOpen: boolean;
 *   onHoverEnter: () => void;
 *   onHoverLeave: () => void;
 *   onSubmenuToggle: () => void;
 *   onSelect: (value: string) => void;
 * }} props
 */
function ParamMenuRow({
  item,
  submenuOpen,
  onHoverEnter,
  onHoverLeave,
  onSubmenuToggle,
  onSelect,
}) {
  const rowRef = useRef(null);
  const { placement: submenuPlacement, panelRef: submenuPanelRef } = useSubmenuPlacement(
    submenuOpen,
    rowRef,
    item.options.length
  );

  return (
    <div ref={rowRef} className="relative" onMouseEnter={onHoverEnter} onMouseLeave={onHoverLeave}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={submenuOpen}
        onClick={(e) => {
          e.stopPropagation();
          onSubmenuToggle();
        }}
        className={`w-full flex items-center gap-3 px-3 py-2 text-xs text-left cursor-pointer ${
          submenuOpen ? 'bg-control-hover/80 text-heading' : 'text-secondary hover:bg-control/60'
        }`}
      >
        <ParamRowLabel label={item.label} valueLabel={item.valueLabel} />
        <ChevronRight
          className={`w-3 h-3 shrink-0 text-faint ${submenuPlacement.side === 'left' ? 'rotate-180' : ''}`}
        />
      </button>
      {submenuOpen && (
        <div
          className={`absolute z-10 ${
            submenuPlacement.side === 'right' ? 'left-full pl-1' : 'right-full pr-1'
          }`}
          style={{ top: submenuPlacement.top }}
        >
          <div
            ref={submenuPanelRef}
            role="menu"
            className={`min-w-[7.5rem] ${DROPDOWN_PANEL_CLASS} py-1`}
          >
            {item.options.map((opt) => {
              const selected = opt.value === item.currentValue;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(opt.value);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                    selected
                      ? 'text-warning bg-control-hover'
                      : 'text-secondary hover:bg-control hover:text-fg'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Settings menu: each row is `Param: value`; binary params use a toggle, others use a value submenu.
 *
 * @param {ComposerParamPickerItem[]} items
 */
export default function ComposerParamPicker({
  items,
  disabled = false,
  placement = 'top-start',
  ariaLabel = 'Message parameters',
}) {
  const [open, setOpen] = useState(false);
  /** @type {[string | null, import('react').Dispatch<import('react').SetStateAction<string | null>>]} */
  const [submenuId, setSubmenuId] = useState(null);
  /** Tap-open submenu stays open until another row is hovered or the menu closes. */
  const [submenuPinned, setSubmenuPinned] = useState(false);
  const submenuPinnedRef = useRef(false);
  useEffect(() => {
    submenuPinnedRef.current = submenuPinned;
  }, [submenuPinned]);

  if (!items.length) return null;

  const closeSubmenu = () => {
    setSubmenuId(null);
    setSubmenuPinned(false);
  };

  const openSubmenuFromHover = (itemId) => {
    setSubmenuPinned(false);
    setSubmenuId(itemId);
  };

  const leaveSubmenuFromHover = (itemId) => {
    if (submenuPinnedRef.current) return;
    setSubmenuId((id) => (id === itemId ? null : id));
  };

  const toggleSubmenuFromTap = (itemId) => {
    if (submenuPinned && submenuId === itemId) {
      setSubmenuPinned(false);
      setSubmenuId(null);
      return;
    }
    setSubmenuPinned(true);
    setSubmenuId(itemId);
  };

  return (
    <AnchoredMenu
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSubmenuId(null);
          setSubmenuPinned(false);
        }
      }}
      placement={placement}
      className={`min-w-[11rem] max-w-[min(100vw-2rem,16rem)] ${DROPDOWN_PANEL_CLASS} py-1 overflow-visible`}
      reference={({ ref, referenceProps }) => (
        <button
          type="button"
          ref={ref}
          {...referenceProps}
          disabled={disabled}
          onClick={(e) => {
            referenceProps.onClick?.(e);
            if (!disabled) setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={ariaLabel}
          title={ariaLabel}
          className="p-1.5 rounded-md text-faint hover:text-secondary hover:bg-control/80 leading-none disabled:opacity-50 disabled:pointer-events-none"
        >
          <Settings className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      )}
    >
      <div role="menu" className="overflow-visible">
        {items.map((item) => {
          const isToggle = item.kind === 'toggle';
          const submenuOpen = !isToggle && submenuId === item.id;
          const toggleOn = binaryParamToggleOn(item.id, item.currentValue);

          if (isToggle) {
            return (
              <div
                key={item.id}
                role="menuitem"
                className="flex items-center gap-3 px-3 py-2 text-xs text-secondary"
                onMouseEnter={closeSubmenu}
                onPointerDown={closeSubmenu}
              >
                <ParamRowLabel label={item.label} valueLabel={item.valueLabel} />
                <ParamToggleSwitch
                  checked={toggleOn}
                  disabled={disabled}
                  onToggle={() => item.onSelect(binaryParamToggledValue(item.currentValue))}
                />
              </div>
            );
          }

          return (
            <ParamMenuRow
              key={item.id}
              item={item}
              submenuOpen={submenuOpen}
              onHoverEnter={() => openSubmenuFromHover(item.id)}
              onHoverLeave={() => leaveSubmenuFromHover(item.id)}
              onSubmenuToggle={() => toggleSubmenuFromTap(item.id)}
              onSelect={(value) => {
                item.onSelect(value);
                closeSubmenu();
              }}
            />
          );
        })}
      </div>
    </AnchoredMenu>
  );
}
