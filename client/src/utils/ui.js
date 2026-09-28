/**
 * Semantic theme class fragments (see --palette-* / --color-* in index.css).
 * Light/dark is applied on html[data-theme], not via `dark:` on each token.
 */

export const PAGE_BG = 'bg-page';

export const NAV_CLASS = 'bg-nav border-b border-line';

export const CARD_CLASS = 'bg-surface border border-line';

export const CARD_MUTED_CLASS = 'rounded-xl border border-line bg-inset/50';

export const PANEL_BG = 'bg-surface';

export const HAIRLINE = 'border-line';
export const STRONG_BORDER = 'border-strong';

export const DROPDOWN_PANEL_CLASS = 'bg-surface border border-strong rounded-lg shadow-xl';

export const MODAL_OVERLAY_CLASS =
  'fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim';

export const MODAL_PANEL_CLASS = 'bg-surface border border-strong rounded-xl shadow-2xl w-full';

export const TEXT_PRIMARY = 'text-fg';
export const TEXT_SECONDARY = 'text-secondary';
export const TEXT_MUTED = 'text-fg-muted';
export const TEXT_FAINT = 'text-faint';
export const TEXT_HEADING = 'text-heading';
export const TEXT_ACCENT = 'text-accent';
export const TEXT_SUCCESS = 'text-success';
export const TEXT_DANGER = 'text-danger';
export const TEXT_INFO = 'text-info';

export const HOVER_SURFACE = 'hover:bg-control';
export const HOVER_SURFACE_HALF = 'hover:bg-control/50';
export const HOVER_TEXT = 'hover:text-fg';

export const MENU_ITEM_CLASS = `flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm ${TEXT_SECONDARY} ${HOVER_TEXT} hover:bg-control-hover/50 transition-colors`;

export const FOCUS_RING_BRAND = 'focus:outline-none focus:ring-2 focus:ring-brand/50';
/** @deprecated use FOCUS_RING_BRAND */
export const FOCUS_RING_AMBER = FOCUS_RING_BRAND;

export const CONTROL_SURFACE = 'bg-control border border-strong';

export const INPUT_CLASS = `w-full ${CONTROL_SURFACE} rounded-lg px-3 py-2 text-sm text-fg placeholder-faint ${FOCUS_RING_BRAND}`;

export const OVERLAY_SCRIM =
  'absolute inset-0 z-20 flex items-center justify-center bg-page/80 backdrop-blur-sm';

export const DIVIDER_Y = 'divide-y divide-line';

export const TOGGLE_TRACK_OFF = 'bg-track';

export const BANNER_DANGER = 'bg-soft-danger/30 border border-danger/40 text-danger';

export const BANNER_WARN = 'bg-soft-accent/20 border border-accent/40 text-warning';

export const TINT_SUCCESS =
  'text-success border-success/40 bg-soft-success/40 hover:border-success hover:bg-soft-success/55';

export const TINT_DANGER =
  'text-danger border-danger/40 bg-soft-danger/40 hover:border-danger hover:bg-soft-danger/55';

export const TINT_WARN_SOFT = 'text-warning bg-soft-accent/30 border border-brand/20';
