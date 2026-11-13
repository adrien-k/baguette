import { AlertCircle } from 'lucide-react';

/** Scheduler / run failure message from `loops.last_error`. */
export default function LoopLastError({ message, className = '', textClassName = 'text-xs' }) {
  if (!message) return null;
  return (
    <p className={`flex items-start gap-1.5 text-danger ${textClassName} ${className}`}>
      <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden />
      <span className="break-all">{message}</span>
    </p>
  );
}
