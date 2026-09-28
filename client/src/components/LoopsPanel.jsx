import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Repeat, Recycle, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { loopsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { describeSchedule, formatLoopRunSubtitle } from '../utils/loopSchedule.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import Tooltip from './Tooltip.jsx';
import CardRepoBadge from './CardRepoBadge.jsx';
import SessionCardLayout from './SessionCardLayout.jsx';

const BADGE =
  'inline-flex items-center gap-1 shrink-0 rounded border border-strong px-1.5 py-0.5 text-[10px] font-medium text-fg-muted';

const SINGLE_SESSION_TOOLTIP =
  'Every run continues in the same session: the conversation is compacted, then the prompt is sent again.';

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
        className={`text-xs text-faint whitespace-pre-wrap break-words ${
          expanded ? '' : 'line-clamp-2'
        }`}
      >
        {prompt}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-faint hover:text-secondary transition-colors"
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
    ? `${SINGLE_SESSION_TOOLTIP} This loop was created from that session and will stop when it is archived.`
    : SINGLE_SESSION_TOOLTIP;

  return (
    <Tooltip content={tooltip} wrap>
      <Link
        to={sessionUrl(session.short_id)}
        aria-label={tooltip}
        className={`${BADGE} hover:text-heading hover:border-faint`}
      >
        <Recycle className={`w-3 h-3 ${strong ? 'text-accent' : 'text-faint'}`} />
        <span className="max-w-20 truncate">{label}</span>
      </Link>
    </Tooltip>
  );
}

function LoopRow({ loop, editing, onEdit, onToggle, onDelete }) {
  const schedule = describeSchedule(loop);
  const { showRepoDetails } = useFilterRoutes();

  const titleExtras = (
    <>
      {loop.single_session && !loop.tied_session && (
        <Tooltip wrap content={SINGLE_SESSION_TOOLTIP}>
          <span className="inline-flex shrink-0 text-fg-muted" aria-label="Single session">
            <Recycle className="w-3.5 h-3.5" />
          </span>
        </Tooltip>
      )}
      <LoopSessionLink loop={loop} />
    </>
  );

  const description = (
    <>
      <LoopPrompt prompt={loop.prompt} />
      {loop.last_error && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="break-all">{loop.last_error}</span>
        </p>
      )}
    </>
  );

  const controls = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={loop.enabled}
        aria-label={loop.enabled ? 'Disable loop' : 'Enable loop'}
        onClick={() => onToggle(loop)}
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
      {schedule && (
        <span className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap text-xs border rounded px-1.5 py-0.5 border-strong bg-control/40 text-fg-muted">
          <Repeat className="w-3 h-3 text-accent" />
          {schedule}
        </span>
      )}
    </div>
  );

  return (
    <SessionCardLayout
      className={editing ? 'border-strong' : ''}
      accentClassName={loop.enabled ? 'border-l-brand' : 'border-l-strong'}
      repo={
        showRepoDetails ? (
          <CardRepoBadge show isGlobal={!!loop.is_global} repoFullName={loop.repo_full_name} />
        ) : null
      }
      indicator={
        <Repeat className={`w-3.5 h-3.5 shrink-0 ${loop.enabled ? 'text-accent' : 'text-faint'}`} />
      }
      title={loop.name || loop.prompt.split('\n')[0]}
      subtitle={formatLoopRunSubtitle(loop)}
      titleExtras={titleExtras}
      description={description}
      controls={controls}
      actions={[
        {
          icon: Pencil,
          onClick: () => onEdit(loop),
          title: 'Edit loop',
          className: `p-1.5 transition-colors ${
            editing ? 'text-accent' : 'text-faint hover:text-heading'
          }`,
        },
        {
          icon: Trash2,
          onClick: () => onDelete(loop),
          title: 'Delete loop',
          className: 'p-1.5 text-faint hover:text-danger transition-colors',
        },
      ]}
    />
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
      <h2 className="text-sm font-medium text-fg-muted mb-2">Loops</h2>
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
