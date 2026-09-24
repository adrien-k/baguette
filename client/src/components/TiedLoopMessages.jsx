import { Repeat, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { describeSchedule, formatCountdown } from '../utils/loopSchedule.js';

export default function TiedLoopMessages({ loops, editHref, onDelete }) {
  if (!loops?.length) return null;
  return (
    <div className="flex flex-col gap-2 px-3 sm:px-4 pb-1">
      {loops.map((loop) => (
        <div
          key={loop.id}
          className="flex flex-col gap-1.5 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-3 py-2.5"
        >
          <div className="flex items-center gap-1.5 text-xs text-amber-400/80 font-medium min-w-0">
            <Repeat className="w-3 h-3 shrink-0" />
            <span className="truncate">
              Sends regularly
              {loop.name ? ` · ${loop.name}` : ''}
              {describeSchedule(loop) ? ` · ${describeSchedule(loop)}` : ''}
              {loop.next_run_at ? ` · next ${formatCountdown(loop.next_run_at)}` : ''}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm text-zinc-300 line-clamp-2 break-words min-w-0 whitespace-pre-wrap">
              {loop.prompt || <span className="text-zinc-500 italic">No prompt</span>}
            </p>
            <div className="flex gap-0.5 shrink-0 -mt-0.5">
              <Link
                to={editHref(loop)}
                title="Edit"
                className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => onDelete(loop)}
                title="Delete"
                className="p-1.5 text-zinc-500 hover:text-red-400 rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
