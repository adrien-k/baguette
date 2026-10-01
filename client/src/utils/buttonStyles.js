/** Solid go-action button (Merge PR, Run plan, Fix issue, etc.) — matches DiffView Merge PR. */
export const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 bg-ok hover:bg-ok-hover text-on-solid text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** Brand primary actions (Save, Send, confirm). */
export const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center bg-brand hover:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand font-medium rounded-lg transition-colors';

/** Neutral actions (Plan, Cancel, run configured task, preview logs, etc.). */
export const NEUTRAL_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-strong bg-surface hover:bg-control text-secondary hover:text-fg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** Ghost / cancel next to a filled action. */
export const GHOST_BUTTON_CLASS =
  'px-4 py-2 text-sm text-secondary hover:text-fg border border-strong hover:border-faint rounded-lg transition-colors disabled:opacity-50';

/** Destructive confirm (delete / unlink). */
export const DANGER_BUTTON_CLASS =
  'px-4 py-2 text-sm bg-err hover:bg-err-hover disabled:opacity-50 text-on-solid rounded-lg font-medium transition-colors';

/** Default padding for {@link PRIMARY_BUTTON_CLASS} in forms and dialogs. */
export const PRIMARY_BUTTON_SIZED = `${PRIMARY_BUTTON_CLASS} px-4 py-2 text-sm`;

/** Play icon on neutral task buttons — accent without a solid action fill. */
export const NEUTRAL_BUTTON_PLAY_ICON_CLASS = 'w-3 h-3 shrink-0 text-success';

/** Denser neutral button for task-panel command shortcuts. */
export const NEUTRAL_BUTTON_COMPACT_CLASS =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded border border-strong bg-surface hover:bg-control text-secondary hover:text-fg text-[11px] leading-tight font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export const NEUTRAL_BUTTON_PLAY_ICON_COMPACT_CLASS = 'w-2.5 h-2.5 shrink-0 text-success';

/** Red stop icon — running tasks in TaskPanel. */
export const TASK_STOP_CONTROL_CLASS =
  'text-danger hover:text-err-hover opacity-60 hover:opacity-100 transition-all';

/** Agent composer stop — same look as task stop, sized for toolbar alignment. */
export const COMPOSER_STOP_BUTTON_CLASS = `inline-flex items-center justify-center shrink-0 h-8 w-8 disabled:opacity-50 disabled:cursor-not-allowed ${TASK_STOP_CONTROL_CLASS}`;
