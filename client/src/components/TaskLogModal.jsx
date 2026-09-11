import { useEffect, useRef, useMemo } from 'react';
import { ExternalLink, GitBranch, RotateCw, Square, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useGetTaskLogs } from '../hooks/useGetTaskLogs.js';
import { ansiToHtml } from '../utils/ansi.js';

export default function TaskLogModal({ task, session, onKill, onRetry, onClose }) {
  const { logs } = useGetTaskLogs(task?.id);
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

  const location = useLocation();

  if (!task) return null;

  const isRunning = task.status === 'running';
  const sessionPath = session?.short_id
    ? `/repos/${session.repo_id}/sessions/${session.short_id}`
    : null;
  const isOnSession = sessionPath && location.pathname === sessionPath;

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
            <code className="text-sm text-zinc-200 truncate">{task.label || task.command}</code>
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
        {session && (
          <div className="px-4 sm:px-5 py-2 border-b border-zinc-800 flex items-center gap-2 sm:gap-3 text-xs flex-wrap">
            {session.label && (
              <span
                className="text-zinc-400 font-medium truncate max-w-[160px]"
                title={session.label}
              >
                {session.label}
              </span>
            )}
            <span className="text-zinc-500">{session.repo_full_name}</span>
            <span className="flex items-center gap-1 text-zinc-600">
              <GitBranch className="w-3 h-3" />
              {session.base_branch}
            </span>
            {session.pr_url && (
              <a
                href={session.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                PR #{session.pr_number}
              </a>
            )}
            {sessionPath && !isOnSession && (
              <a
                href={sessionPath}
                className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors ml-auto"
              >
                <ExternalLink className="w-3 h-3" />
                Open session
              </a>
            )}
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
