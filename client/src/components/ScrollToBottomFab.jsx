import { ChevronDown } from 'lucide-react';

export default function ScrollToBottomFab({ onClick, className = 'bottom-5 right-4 sm:right-6' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to bottom"
      className={`absolute z-[2] flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-800/95 text-zinc-300 shadow-md hover:border-sky-500/35 hover:bg-zinc-800 hover:text-sky-200 transition-colors ${className}`}
    >
      <ChevronDown className="w-4 h-4 shrink-0" aria-hidden />
    </button>
  );
}
