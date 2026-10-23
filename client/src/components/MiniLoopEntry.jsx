import { Link } from 'react-router-dom';
import { Repeat, Trash2 } from 'lucide-react';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import {
  describeSchedule,
  formatLoopRunSubtitle,
  loopDisplayTitle,
} from '../utils/loopSchedule.js';
import { toastError } from '../utils/toastError.jsx';
import { loopsService } from '../feathers.js';
import CardRepoBadge from './CardRepoBadge.jsx';
import LoopLastError from './LoopLastError.jsx';

export default function MiniLoopEntry({ loop, currentLoopId, onToggle, onDelete }) {
  const { loopEditUrl, showRepoDetails } = useFilterRoutes();
  const isCurrent = String(loop.id) === String(currentLoopId);
  const title = loopDisplayTitle(loop);
  const schedule = describeSchedule(loop);
  const subtitle = formatLoopRunSubtitle(loop);

  const handleToggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await loopsService.patch(loop.id, { enabled: !loop.enabled });
      onToggle?.();
    } catch (err) {
      toastError('Failed to update loop', err);
    }
  };

  return (
    <div
      className={`group px-3 py-2 text-xs transition-colors ${
        isCurrent ? 'bg-control-hover' : 'hover:bg-control/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <Repeat
          className={`w-3.5 h-3.5 shrink-0 ${loop.enabled ? 'text-accent' : 'text-faint'}`}
          aria-hidden
        />
        <Link to={loopEditUrl(loop.id)} className="flex-1 min-w-0 leading-snug text-left">
          {showRepoDetails && (
            <span className="block truncate">
              <CardRepoBadge show isGlobal={!!loop.is_global} repoFullName={loop.repo_full_name} />
            </span>
          )}
          <span className={`block truncate font-medium ${isCurrent ? 'text-fg' : 'text-heading'}`}>
            {title}
          </span>
          {subtitle && <span className="block truncate text-[11px] text-faint">{subtitle}</span>}
          {schedule && !subtitle && (
            <span className="block truncate text-[11px] text-faint">{schedule}</span>
          )}
          <LoopLastError message={loop.last_error} textClassName="text-[11px] mt-0.5" />
        </Link>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(loop);
            }}
            className="shrink-0 p-1 text-faint opacity-0 transition-colors hover:text-danger group-hover:opacity-100"
            title="Delete loop"
            aria-label="Delete loop"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={loop.enabled}
          aria-label={loop.enabled ? 'Disable loop' : 'Enable loop'}
          onClick={handleToggle}
          className="shrink-0"
        >
          <span
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
              loop.enabled ? 'bg-brand' : 'bg-track'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-knob shadow transition-transform ${
                loop.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
