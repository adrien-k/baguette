import { useState, useEffect, useCallback } from 'react';
import { Repeat, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { loopsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { formatRelativeTime } from '../utils/dates.js';
import { describeSchedule, formatCountdown } from '../utils/loopSchedule.js';
import Tooltip from './Tooltip.jsx';

function LoopRow({ loop, editing, onEdit, onToggle, onDelete }) {
  return (
    <div
      className={`bg-zinc-900 border rounded-lg p-3 border-l-2 ${
        editing ? 'border-zinc-600' : 'border-zinc-800'
      } ${loop.enabled ? 'border-l-amber-500' : 'border-l-zinc-700'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <Repeat
              className={`w-3.5 h-3.5 shrink-0 ${loop.enabled ? 'text-amber-400' : 'text-zinc-600'}`}
            />
            <span className="text-sm text-zinc-200 truncate">
              {loop.name || loop.prompt.split('\n')[0]}
            </span>
            {loop.single_session && (
              <Tooltip content="Every run continues in the same session: the conversation is compacted, then the prompt is sent again.">
                <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                  Single session
                </span>
              </Tooltip>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500 truncate">
            {describeSchedule(loop)}
            <span className="text-zinc-600"> · {loop.base_branch}</span>
            {loop.enabled && loop.next_run_at && (
              <span className="text-zinc-600"> · next {formatCountdown(loop.next_run_at)}</span>
            )}
            {loop.last_run_at && (
              <span className="text-zinc-600">
                {' '}
                · last run {formatRelativeTime(loop.last_run_at)}
              </span>
            )}
          </p>
          {loop.last_error && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <span className="break-all">{loop.last_error}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={loop.enabled}
            aria-label={loop.enabled ? 'Disable loop' : 'Enable loop'}
            onClick={() => onToggle(loop)}
            className="mr-1"
          >
            <span
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                loop.enabled ? 'bg-amber-500' : 'bg-zinc-600'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  loop.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
          <button
            type="button"
            onClick={() => onEdit(loop)}
            aria-label="Edit loop"
            className={`p-1.5 transition-colors ${
              editing ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(loop)}
            aria-label="Delete loop"
            className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Loops configured for one repo: what they run, when they run next, and the controls to
 * edit, enable/disable or delete them.
 */
export default function LoopsPanel({ repoFullName, editingLoopId, onEdit, refreshToken }) {
  const [loops, setLoops] = useState([]);

  // `refreshToken` is bumped by the page after it creates or saves a loop: those mutations happen
  // outside this component, and waiting on the SSE round-trip to show them is a race.
  const load = useCallback(() => {
    if (!repoFullName) return;
    loopsService
      .find({ query: { repo_full_name: repoFullName, $limit: 100 } })
      .then((d) => setLoops(d.data ?? d))
      .catch((err) => toastError('Failed to load loops', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName, refreshToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Runs update loops in the background (last_run_at, next_run_at), so follow the SSE stream.
  useEffect(() => {
    const refresh = () => load();
    loopsService.on('created', refresh);
    loopsService.on('patched', refresh);
    loopsService.on('removed', refresh);
    return () => {
      loopsService.off('created', refresh);
      loopsService.off('patched', refresh);
      loopsService.off('removed', refresh);
    };
  }, [load]);

  const handleToggle = async (loop) => {
    try {
      await loopsService.patch(loop.id, { enabled: !loop.enabled });
      load();
    } catch (err) {
      toastError('Failed to update loop', err);
    }
  };

  const handleDelete = async (loop) => {
    if (!window.confirm(`Delete loop "${loop.name || loop.prompt.slice(0, 40)}"?`)) return;
    try {
      await loopsService.remove(loop.id);
      load();
    } catch (err) {
      toastError('Failed to delete loop', err);
    }
  };

  if (!loops.length) return null;

  return (
    <div className="mb-4 sm:mb-6">
      <h2 className="text-sm font-medium text-zinc-400 mb-2">Loops</h2>
      <div className="space-y-2">
        {loops.map((loop) => (
          <LoopRow
            key={loop.id}
            loop={loop}
            editing={loop.id === editingLoopId}
            onEdit={onEdit}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
