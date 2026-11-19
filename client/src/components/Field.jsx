import { TEXT_FAINT, TEXT_SECONDARY } from '../utils/ui.js';

/** Label + optional hint + control, used in settings and dialogs. */
export default function Field({ label, hint, labelAccessory, children, className = 'mb-4' }) {
  return (
    <div className={className}>
      {label ? (
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`text-sm font-medium ${TEXT_SECONDARY}`}>{label}</span>
          {labelAccessory}
        </div>
      ) : null}
      {hint ? <p className={`text-xs ${TEXT_FAINT} mb-2`}>{hint}</p> : null}
      {children}
    </div>
  );
}
