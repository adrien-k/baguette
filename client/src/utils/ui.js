/**
 * Semantic theme class fragments (see --palette-* / --color-* in index.css).
 * Light/dark is applied on html[data-theme], not via `dark:` on each token.
 */

export const PAGE_BG = 'bg-page';

export const NAV_CLASS = 'bg-nav border-b border-line';

export const CARD_MUTED_CLASS = 'rounded-xl border border-line bg-inset/50';

export const HAIRLINE = 'border-line';
export const DROPDOWN_PANEL_CLASS = 'bg-surface border border-strong rounded-lg shadow-xl';

export const MODAL_OVERLAY_CLASS = 'fixed inset-0 z-50 overflow-y-auto bg-scrim';

export const MODAL_PANEL_CLASS =
  'bg-surface border border-strong rounded-xl shadow-2xl w-full min-w-0 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain';

export const TEXT_PRIMARY = 'text-fg';
export const TEXT_SECONDARY = 'text-secondary';
export const TEXT_MUTED = 'text-fg-muted';
export const TEXT_FAINT = 'text-faint';
export const TEXT_HEADING = 'text-heading';
export const TEXT_ACCENT = 'text-accent';
export const TEXT_SUCCESS = 'text-success';
export const TEXT_DANGER = 'text-danger';
const HOVER_TEXT = 'hover:text-fg';

/** Small underlined text links (settings prompts, config shortcuts). */
export const INLINE_SECONDARY_LINK_CLASS = `text-xs ${TEXT_SECONDARY} ${HOVER_TEXT} underline cursor-pointer`;

export const MENU_ITEM_CLASS = `flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm ${TEXT_SECONDARY} ${HOVER_TEXT} hover:bg-control-hover/50 transition-colors`;

const FOCUS_RING_BRAND = 'focus:outline-none focus:ring-2 focus:ring-brand/50';
/** @deprecated use FOCUS_RING_BRAND */
const CONTROL_SURFACE = 'bg-control border border-strong';

export const INPUT_CLASS = `w-full ${CONTROL_SURFACE} rounded-lg px-3 py-2 text-sm text-fg placeholder-faint ${FOCUS_RING_BRAND}`;

export const TOGGLE_TRACK_OFF = 'bg-track';

export const BANNER_DANGER = 'bg-soft-danger/30 border border-danger/40 text-danger';

export const BANNER_WARN = 'bg-soft-accent/20 border border-accent/40 text-warning';

export const TINT_WARN_SOFT = 'text-warning bg-soft-accent/30 border border-brand/20';
