import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RotateCw, Square, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetTaskLogs } from '../hooks/useGetTaskLogs.js';
import { useTaskRunDuration } from '../hooks/useTaskRunDuration.js';
import { ansiToHtml } from '../utils/ansi.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import { isAtScrollBottom } from '../utils/scrollBottom.js';
import TaskDockerIcon from './TaskDockerIcon.jsx';

function selectionIn(el) {
  if (!el) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const node = sel.anchorNode;
  return node ? el.contains(node) : false;
}

function TaskRunDurationText({ task, isRunning }) {
  const runDuration = useTaskRunDuration(task);
  if (!runDuration) return null;
  return (
    <span className="text-[11px] text-faint tabular-nums">
      {isRunning ? 'Running for ' : 'Ran for '}
      {runDuration}
    </span>
  );
}

const TaskLogPre = memo(function TaskLogPre({ html }) {
  return (
    <pre
      className="whitespace-pre-wrap break-all sm:break-normal m-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export default function TaskLogModal({ task, session, onKill, onRetry, onClose }) {
  const { logs } = useGetTaskLogs(task?.id);
  const logRef = useRef(null);
  const atBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const skipLogUpdatesRef = useRef(false);
  const logsHtmlRef = useRef('');
  const [viewHtml, setViewHtml] = useState('');
  const logsHtml = useMemo(() => (logs ? ansiToHtml(logs) : ''), [logs]);

  const publishLogs = (html) => {
    if (skipLogUpdatesRef.current || selectionIn(logRef.current)) return;
    setViewHtml(html);
  };

  useEffect(() => {
    atBottomRef.current = true;
    lastScrollTopRef.current = 0;
  }, [task?.id]);

  useLayoutEffect(() => {
    logsHtmlRef.current = logsHtml;
    publishLogs(logsHtml);
  }, [logsHtml]);

  useEffect(() => {
    const endSelect = () => {
      skipLogUpdatesRef.current = false;
      publishLogs(logsHtmlRef.current);
    };
    document.addEventListener('pointerup', endSelect);
    document.addEventListener('pointercancel', endSelect);
    return () => {
      document.removeEventListener('pointerup', endSelect);
      document.removeEventListener('pointercancel', endSelect);
    };
  }, []);

  useEffect(() => {
    const onSelectionChange = () => {
      if (skipLogUpdatesRef.current) return;
      if (selectionIn(logRef.current)) return;
      publishLogs(logsHtmlRef.current);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      lastScrollTopRef.current = el.scrollTop;
      atBottomRef.current = isAtScrollBottom(el);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [task?.id]);

  useLayoutEffect(() => {
    const wrap = logRef.current;
    if (!wrap || !viewHtml) return;
    wrap.scrollTop = atBottomRef.current ? wrap.scrollHeight : lastScrollTopRef.current;
  }, [viewHtml]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const { sessionUrl } = useFilterRoutes();

  if (!task) return null;

  const isRunning = task.status === 'running';
  const sessionPath = session?.short_id ? sessionUrl(session.short_id) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-nav sm:border sm:border-strong sm:rounded-xl shadow-2xl w-full h-full sm:w-[720px] sm:max-w-[90vw] sm:max-h-[80vh] sm:h-auto flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-line">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isRunning ? 'bg-ok animate-pulse' : 'bg-track'
              }`}
            />
            <div className="min-w-0 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <TaskDockerIcon task={task} />
                <code className="text-sm text-heading truncate min-w-0">
                  {task.label || task.command}
                </code>
              </div>
              <TaskRunDurationText task={task} isRunning={isRunning} />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!isRunning && (
              <>
                <span
                  className={`text-xs font-medium ${
                    task.exitCode === 0 ? 'text-success' : 'text-danger'
                  }`}
                >
                  exit {task.exitCode}
                </span>
                {onRetry && (
                  <button
                    onClick={() => onRetry(task.id)}
                    className="text-faint hover:text-accent transition-colors"
                    title="Retry"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                )}
              </>
            )}
            {isRunning && (
              <button
                onClick={() => onKill(task.id)}
                className="text-danger hover:text-danger opacity-60 hover:opacity-100 transition-all"
                title="Stop"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-faint hover:text-secondary transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {session && (session.repo_full_name || session.label) && (
          <div className="px-4 sm:px-5 py-2 border-b border-line flex items-center gap-2 text-xs min-w-0">
            {session.repo_full_name && (
              <span className="text-faint shrink-0">{session.repo_full_name}</span>
            )}
            {session.label &&
              (sessionPath ? (
                <Link
                  to={sessionPath}
                  onClick={onClose}
                  className="text-secondary hover:text-fg font-medium truncate min-w-0 transition-colors"
                  title={session.label}
                >
                  {session.label}
                </Link>
              ) : (
                <span className="text-fg-muted font-medium truncate min-w-0" title={session.label}>
                  {session.label}
                </span>
              ))}
          </div>
        )}

        <div
          ref={logRef}
          className="ansi-log flex-1 overflow-auto p-3 sm:p-4 font-mono text-xs leading-relaxed select-text"
          onPointerDown={() => {
            skipLogUpdatesRef.current = true;
          }}
        >
          {viewHtml ? (
            <TaskLogPre html={viewHtml} />
          ) : (
            <span className="text-[#52525b]">
              {isRunning ? 'Waiting for output...' : 'No output recorded.'}
            </span>
          )}
        </div>

        {isRunning && (
          <div className="px-4 sm:px-5 py-2 border-t border-line flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse" />
            <span className="text-xs text-faint">Live</span>
          </div>
        )}
      </div>
    </div>
  );
}
