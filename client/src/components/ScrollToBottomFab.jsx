import { ChevronDown } from 'lucide-react';

export default function ScrollToBottomFab({ onClick, className = 'bottom-5 right-4 sm:right-6' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to bottom"
      className={`absolute z-[2] flex h-8 w-8 items-center justify-center rounded-full border border-strong/80 bg-control/95 text-secondary shadow-md hover:border-info/35 hover:bg-control hover:text-info transition-colors ${className}`}
    >
      <ChevronDown className="w-4 h-4 shrink-0" aria-hidden />
    </button>
  );
}
