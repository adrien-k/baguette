import { AlertCircle, Info, X } from 'lucide-react';

/** Semantic alert surfaces using translucent fills and light/dark text tokens. */
const VARIANTS = {
  info: {
    Icon: Info,
    container: 'border-info/30 bg-info/10 text-info/95 [&_a]:text-info [&_a:hover]:text-info',
    icon: 'text-info',
  },
  alert: {
    Icon: AlertCircle,
    container:
      'border-brand/30 bg-brand/10 text-warning/95 [&_a]:text-accent [&_a:hover]:text-warning',
    icon: 'text-accent',
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
