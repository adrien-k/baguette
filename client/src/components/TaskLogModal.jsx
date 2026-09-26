import { useEffect, useRef, useMemo } from 'react';
import { RotateCw, Square, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetTaskLogs } from '../hooks/useGetTaskLogs.js';
import { useTaskRunDuration } from '../hooks/useTaskRunDuration.js';
import { ansiToHtml } from '../utils/ansi.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';

export default function TaskLogModal({ task, session, onKill, onRetry, onClose }) {
  const { logs } = useGetTaskLogs(task?.id);
  const runDuration = useTaskRunDuration(task);
  const logRef = useRef(null);
  const logsHtml = useMemo(() => {
    if (!logs) return '';
    return ansiToHtml(logs);
  }, [logs]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

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
      <div className="bg-zinc-900 sm:border sm:border-zinc-700 sm:rounded-xl shadow-2xl w-full h-full sm:w-[720px] sm:max-w-[90vw] sm:max-h-[80vh] sm:h-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
              }`}
            />
            <div className="min-w-0 flex flex-col gap-0.5">
              <code className="text-sm text-zinc-200 truncate">{task.label || task.command}</code>
              {runDuration && (
                <span className="text-[11px] text-zinc-500 tabular-nums">
                  {isRunning ? 'Running for ' : 'Ran for '}
                  {runDuration}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!isRunning && (
              <>
                <span
                  className={`text-xs font-medium ${
                    task.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  exit {task.exitCode}
                </span>
                {onRetry && (
                  <button
                    onClick={() => onRetry(task.id)}
                    className="text-zinc-500 hover:text-amber-400 transition-colors"
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
                className="text-red-400 hover:text-red-300 opacity-60 hover:opacity-100 transition-all"
                title="Stop"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Session info */}
        {session && (session.repo_full_name || session.label) && (
          <div className="px-4 sm:px-5 py-2 border-b border-zinc-800 flex items-center gap-2 text-xs min-w-0">
            {session.repo_full_name && (
              <span className="text-zinc-500 shrink-0">{session.repo_full_name}</span>
            )}
            {session.label &&
              (sessionPath ? (
                <Link
                  to={sessionPath}
                  onClick={onClose}
                  className="text-zinc-300 hover:text-white font-medium truncate min-w-0 transition-colors"
                  title={session.label}
                >
                  {session.label}
                </Link>
              ) : (
                <span className="text-zinc-400 font-medium truncate min-w-0" title={session.label}>
                  {session.label}
                </span>
              ))}
          </div>
        )}

        {/* Logs */}
        <div
          ref={logRef}
          className="flex-1 overflow-auto p-3 sm:p-4 font-mono text-xs text-zinc-400 leading-relaxed bg-zinc-950"
        >
          {logsHtml ? (
            <pre
              className="whitespace-pre-wrap break-all sm:break-normal m-0"
              dangerouslySetInnerHTML={{ __html: logsHtml }}
            />
          ) : (
            <span className="text-zinc-600">
              {isRunning ? 'Waiting for output...' : 'No output recorded.'}
            </span>
          )}
        </div>

        {/* Footer */}
        {isRunning && (
          <div className="px-4 sm:px-5 py-2 border-t border-zinc-800 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-zinc-500">Live</span>
          </div>
        )}
      </div>
    </div>
  );
}
