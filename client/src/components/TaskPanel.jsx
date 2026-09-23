import { useState } from 'react';
import { Play, RotateCw, Square, Trash2 } from 'lucide-react';
import { formatRelativeTime } from '../utils/dates.js';
import { useTaskRunDuration } from '../hooks/useTaskRunDuration.js';

function TaskMetaLine({ task }) {
  const duration = useTaskRunDuration(task);
  const relative = task.created_at ? formatRelativeTime(task.created_at) : null;
  if (!relative && !duration) return null;
  return (
    <span className="text-[10px] text-zinc-600">
      {relative}
      {relative && duration ? ' · ' : null}
      {duration ? <span className="text-zinc-500 tabular-nums">{duration}</span> : null}
    </span>
  );
}

export default function TaskPanel({
  tasks,
  configCommands = [],
  onStartTask,
  onRunCommand,
  onKill,
  onDelete,
  onRetry,
  onViewLogs,
  readonly,
}) {
  const [command, setCommand] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!command.trim()) return;
    onRunCommand(command.trim());
    setCommand('');
  };

  const runningTasks = [...tasks.filter((t) => t.status === 'running')].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
  const finishedTasks = [...tasks.filter((t) => t.status !== 'running')].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const renderTask = (task) => (
    <button
      key={task.id}
      onClick={() => onViewLogs(task.id)}
      className="w-full border-b border-zinc-800 flex items-start justify-between px-3 py-2 hover:bg-zinc-800/50 transition-colors text-left gap-2"
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <span
          className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
            task.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
          }`}
        />
        <div className="min-w-0 flex-1">
          <code className="text-xs text-zinc-300 truncate block">{task.label || task.command}</code>
          {task.ports && Object.keys(task.ports).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {Object.entries(task.ports).map(([name, port]) => (
                <span
                  key={name}
                  className="text-[10px] font-mono text-sky-400/80 bg-sky-400/10 rounded px-1"
                >
                  {name}={port}
                </span>
              ))}
            </div>
          )}
          <TaskMetaLine task={task} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        {task.status === 'exited' && (
          <span className={`text-xs ${task.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            exit {task.exitCode}
          </span>
        )}
        {!readonly && task.status === 'exited' && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onRetry(task.id);
            }}
            className="text-zinc-500 hover:text-amber-400 transition-colors"
            title="Retry"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </span>
        )}
        {!readonly && task.status === 'running' && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onKill(task.id);
            }}
            className="text-red-400 hover:text-red-300 opacity-60 hover:opacity-100 transition-all"
            title="Stop"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </span>
        )}
        {!readonly && onDelete && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task.id);
            }}
            className="text-zinc-600 hover:text-red-400 transition-colors"
            title="Remove"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      {!readonly && configCommands.length > 0 && (
        <div className="p-2 border-b border-zinc-800 flex flex-wrap gap-1.5">
          {configCommands.map((cmd, i) => (
            <button
              key={i}
              onClick={() => onStartTask(cmd.label)}
              className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 transition-colors"
              title={cmd.run}
            >
              <Play className="w-3 h-3 text-emerald-400" />
              {cmd.label}
            </button>
          ))}
        </div>
      )}

      {!readonly && (
        <form onSubmit={handleSubmit} className="p-3 border-b border-zinc-800">
          <div className="flex gap-2">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Run a command..."
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-mono"
            />
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-400 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              Run
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-auto">
        {tasks.length === 0 && (
          <div className="flex flex-col items-center py-10 gap-2 opacity-40">
            <img src="/baguette.svg" alt="" className="w-7 h-7" />
            <p className="text-zinc-600 text-xs">No tasks yet</p>
          </div>
        )}
        {runningTasks.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-800 bg-zinc-900">
              Running
            </div>
            {runningTasks.map(renderTask)}
          </>
        )}
        {finishedTasks.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-800 bg-zinc-900">
              Finished
            </div>
            {finishedTasks.map(renderTask)}
          </>
        )}
      </div>
    </div>
  );
}
