/** Solid go-action button (Merge PR, Run plan, Fix issue, etc.) — matches DiffView Merge PR. */
export const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** Neutral actions (Plan, Cancel, run configured task, preview logs, etc.). */
export const NEUTRAL_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/** Play icon on neutral task buttons — accent without a solid action fill. */
export const NEUTRAL_BUTTON_PLAY_ICON_CLASS = 'w-3 h-3 shrink-0 text-emerald-400';

/** Red stop icon — running tasks in TaskPanel. */
export const TASK_STOP_CONTROL_CLASS =
  'text-red-400 hover:text-red-300 opacity-60 hover:opacity-100 transition-all';

/** Agent composer stop — same look as task stop, sized for toolbar alignment. */
export const COMPOSER_STOP_BUTTON_CLASS = `inline-flex items-center justify-center shrink-0 h-8 w-8 disabled:opacity-50 disabled:cursor-not-allowed ${TASK_STOP_CONTROL_CLASS}`;
