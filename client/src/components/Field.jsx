import { TEXT_FAINT, TEXT_SECONDARY } from '../utils/ui.js';

/** Label + optional hint + control, used in settings and dialogs. */
export default function Field({ label, hint, children, className = 'mb-4' }) {
  return (
    <div className={className}>
      {label ? (
        <label className={`block text-sm font-medium ${TEXT_SECONDARY} mb-1`}>{label}</label>
      ) : null}
      {hint ? <p className={`text-xs ${TEXT_FAINT} mb-2`}>{hint}</p> : null}
      {children}
    </div>
  );
}
