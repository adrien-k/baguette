/** Wrap long diff/code lines in chat and session diff UIs (no horizontal scroll). */
export const DIFF_LINE_WRAP_CLASS = 'min-w-0 max-w-full whitespace-pre-wrap break-words';

/** Session diff file bodies: constrain width only — avoid overflow-x-hidden (forces overflow-y: auto). */
export const DIFF_FILE_BODY_CLASS = 'min-w-0 max-w-full';

export const DIFF_SCROLL_WRAP_CLASS = 'overflow-y-auto overflow-x-hidden max-w-full';
