import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Repeat, Pencil, Trash2, AlertCircle, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { loopsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { describeSchedule, formatCountdown } from '../utils/loopSchedule.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import Tooltip from './Tooltip.jsx';
import CardRepoBadge from './CardRepoBadge.jsx';
import CardBranchModel from './CardBranchModel.jsx';

const BADGE =
  'inline-flex items-center gap-1 shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400';

function LoopPrompt({ prompt }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [prompt, expanded]);

  if (!prompt?.trim()) return null;

  return (
    <div>
      <p
        ref={ref}
        className={`text-xs text-zinc-500 whitespace-pre-wrap break-words ${
          expanded ? '' : 'line-clamp-2'
        }`}
      >
        {prompt}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

function LoopSessionLink({ loop }) {
  const session = loop.tied_session;
  const { sessionUrl } = useFilterRoutes();
  if (!session) return null;

  const strong = loop.session_link === 'strong';
  const label = session.label || `Session ${session.short_id}`;
  const tooltip = strong
    ? `Strong link: this loop was created from ${label}. Archiving that session removes the loop.`
    : `Weak link: ${label} was started by this loop. If that session is archived, the next run starts a new one.`;

  return (
    <Tooltip content={tooltip} wrap>
      <Link
        to={sessionUrl(session.short_id)}
        aria-label={tooltip}
        className={`${BADGE} hover:text-zinc-200 hover:border-zinc-500`}
      >
        <Link2 className={`w-3 h-3 ${strong ? 'text-amber-400' : 'text-zinc-500'}`} />
        <span className="max-w-[10rem] truncate">{label}</span>
      </Link>
    </Tooltip>
  );
}

function LoopRow({ loop, editing, onEdit, onToggle, onDelete }) {
  const schedule = describeSchedule(loop);
  const { showRepoDetails } = useFilterRoutes();

  return (
    <div
      className={`w-full bg-zinc-900 border rounded-lg p-3 sm:p-4 border-l-2 ${
        editing ? 'border-zinc-600' : 'border-zinc-800'
      } ${loop.enabled ? 'border-l-amber-500' : 'border-l-zinc-700'}`}
    >
      {showRepoDetails && (
        <div className="mb-1.5">
          <CardRepoBadge show isGlobal={!!loop.is_global} repoFullName={loop.repo_full_name} />
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Repeat
            className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${loop.enabled ? 'text-amber-400' : 'text-zinc-600'}`}
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span className="text-white font-medium text-sm min-w-0 max-w-full break-words">
              {loop.name || loop.prompt.split('\n')[0]}
            </span>
            {loop.single_session && (
              <Tooltip content="Every run continues in the same session: the conversation is compacted, then the prompt is sent again.">
                <span className={BADGE}>Single session</span>
              </Tooltip>
            )}
            <LoopSessionLink loop={loop} />
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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
      <CardBranchModel
        isGlobal={!!loop.is_global}
        baseBranch={loop.base_branch}
        targetBranch={!loop.is_global && loop.create_new_branch ? 'new branch' : null}
        agentSdk={loop.agent_sdk}
        model={loop.model}
      />
      <div className="ml-5">
        <LoopPrompt prompt={loop.prompt} />
        {loop.last_error && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="break-all">{loop.last_error}</span>
          </p>
        )}
      </div>
      <div className="mt-1.5 sm:mt-2 ml-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={loop.enabled}
          aria-label={loop.enabled ? 'Disable loop' : 'Enable loop'}
          onClick={() => onToggle(loop)}
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
        {schedule && (
          <span className="inline-flex items-center gap-1 text-xs border rounded px-1.5 py-0.5 border-zinc-700 bg-zinc-800/40 text-zinc-400">
            <Repeat className="w-3 h-3 text-amber-400" />
            {schedule}
          </span>
        )}
        {loop.enabled && loop.next_run_at && (
          <span className="text-xs text-zinc-500">{formatCountdown(loop.next_run_at)}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Loops configured for one repo: what they run, when they run next, and the controls to
 * edit, enable/disable or delete them.
 */
export default function LoopsPanel({ query, repoFullName, editingLoopId, onEdit, refreshToken }) {
  const [loops, setLoops] = useState([]);

  // `refreshToken` is bumped by the page after it creates or saves a loop: those mutations happen
  // outside this component, and waiting on the SSE round-trip to show them is a race.
  const load = useCallback(() => {
    const findQuery = query ?? (repoFullName ? { repo_full_name: repoFullName } : null);
    if (!findQuery) return;
    loopsService
      .find({ query: { ...findQuery, $limit: 100 } })
      .then((d) => setLoops(d.data ?? d))
      .catch((err) => toastError('Failed to load loops', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshToken forces a reload after local mutations
  }, [query, repoFullName, refreshToken]);

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
