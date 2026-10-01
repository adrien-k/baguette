/** Shared split-button chrome. Callers pass layout via className / chevronClassName / groupClassName. */

export const SPLIT_GROUP_CLASS = 'group/split inline-flex items-stretch shrink-0';

export const SPLIT_BRAND_FILL =
  'bg-brand hover:enabled:bg-brand-hover group-hover/split:enabled:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand transition-colors';

export const SPLIT_DIVIDER =
  'border border-transparent border-r border-brand/40 group-hover/split:enabled:border-brand/50 disabled:border-r-track';

export const SPLIT_PRIMARY_CLASS =
  'inline-flex items-center justify-center shrink-0 h-8 text-sm font-medium';

export const SPLIT_CHEVRON_CLASS =
  'inline-flex items-center justify-center shrink-0 h-8 text-sm font-medium';
