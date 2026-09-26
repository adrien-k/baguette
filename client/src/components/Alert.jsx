import { AlertCircle, Info, X } from 'lucide-react';

/**
 * Semantic alert surfaces using translucent fills (work in dark + light themes).
 * Text/icon tokens follow index.css light-theme overrides where applicable.
 */
const VARIANTS = {
  info: {
    Icon: Info,
    container:
      'border-sky-500/30 bg-sky-500/10 text-sky-200/95 [&_a]:text-sky-300 [&_a:hover]:text-sky-200',
    icon: 'text-sky-400',
  },
  alert: {
    Icon: AlertCircle,
    container:
      'border-amber-500/30 bg-amber-500/10 text-amber-200/95 [&_a]:text-amber-300 [&_a:hover]:text-amber-200',
    icon: 'text-amber-400',
  },
};

export default function Alert({ variant = 'info', children, className = '', onDismiss }) {
  const { Icon, container, icon } = VARIANTS[variant] ?? VARIANTS.info;

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-md border px-3 sm:px-4 py-3 text-sm ${container} ${className}`}
    >
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${icon}`} aria-hidden />
      <div className="min-w-0 flex-1 [&_a]:underline [&_a]:font-medium">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-current opacity-70 hover:opacity-100 p-0.5 -m-0.5"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
