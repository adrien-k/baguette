import { useState } from 'react';
import { RotateCw, Square, Trash2 } from 'lucide-react';
import { formatRelativeTime } from '../utils/dates.js';
import { useTaskRunDuration } from '../hooks/useTaskRunDuration.js';
import { NEUTRAL_BUTTON_CLASS, TASK_STOP_CONTROL_CLASS } from '../utils/buttonStyles.js';
import BaguetteIcon from './svg/BaguetteIcon.jsx';
import StartButton from './StartButton.jsx';
import TaskDockerIcon from './TaskDockerIcon.jsx';
import {
  configCommandButtonLabel,
  groupConfigCommandsForPanel,
} from '../utils/taskPanelGrouping.js';
import { INLINE_SECONDARY_LINK_CLASS } from '../utils/ui.js';

function TaskMetaLine({ task }) {
  const duration = useTaskRunDuration(task);
  const relative = task.created_at ? formatRelativeTime(task.created_at) : null;
  if (!relative && !duration) return null;
  return (
    <span className="text-[10px] text-faint">
      {relative}
      {relative && duration ? ' · ' : null}
      {duration ? <span className="text-faint tabular-nums">{duration}</span> : null}
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
  onViewBaguetteConfig,
  showBaguetteConfigLink = false,
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
      className="w-full border-b border-line flex items-start justify-between px-3 py-2 hover:bg-control/50 transition-colors text-left gap-2"
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <span
          className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
            task.status === 'running' ? 'bg-ok animate-pulse' : 'bg-track'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <TaskDockerIcon task={task} className="w-3 h-3" />
            <code className="text-xs text-secondary truncate block min-w-0">
              {task.label || task.command}
            </code>
          </div>
          {task.ports && Object.keys(task.ports).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {Object.entries(task.ports).map(([name, port]) => (
                <span
                  key={name}
                  className="text-[10px] font-mono text-info/80 bg-info/10 rounded px-1"
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
          <span className={`text-xs ${task.exitCode === 0 ? 'text-success' : 'text-danger'}`}>
            exit {task.exitCode}
          </span>
        )}
        {!readonly && task.status === 'exited' && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onRetry(task.id);
            }}
            className="text-faint hover:text-accent transition-colors"
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
            className={TASK_STOP_CONTROL_CLASS}
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
            className="text-faint hover:text-danger transition-colors"
            title="Remove"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </button>
  );

  const { ungrouped: ungroupedCommands, namespaces: commandNamespaces } =
    groupConfigCommandsForPanel(configCommands);

  const renderStartButtons = () => (
    <>
      {ungroupedCommands.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 border-b border-line">
          {ungroupedCommands.map((cmd) => (
            <StartButton key={cmd.label} onClick={() => onStartTask(cmd.label)} title={cmd.run}>
              {cmd.label}
            </StartButton>
          ))}
        </div>
      )}
      {commandNamespaces.map(({ namespace, items }) => (
        <div key={namespace} className="border-b border-line">
          <div className="px-3 py-1 text-[10px] font-medium text-faint uppercase tracking-wider bg-page/40">
            {namespace}
          </div>
          <div className="flex flex-wrap gap-1.5 p-2 pl-4">
            {items.map((cmd) => (
              <StartButton key={cmd.label} onClick={() => onStartTask(cmd.label)} title={cmd.run}>
                {configCommandButtonLabel(cmd, true)}
              </StartButton>
            ))}
          </div>
        </div>
      ))}
    </>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {showBaguetteConfigLink && onViewBaguetteConfig && (
        <div className="shrink-0 px-3 py-2 border-b border-line bg-page/40">
          <button
            type="button"
            onClick={onViewBaguetteConfig}
            className={`${INLINE_SECONDARY_LINK_CLASS} text-left`}
          >
            View <code className="text-secondary">.baguette.yaml</code>
          </button>
        </div>
      )}
      {!readonly && configCommands.length > 0 && (
        <div className="shrink-0">{renderStartButtons()}</div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {tasks.length === 0 && (
          <div className="flex flex-col items-center py-10 gap-2 opacity-40">
            <BaguetteIcon className="w-7 h-7" />
            <p className="text-faint text-xs">No tasks yet</p>
          </div>
        )}
        {runningTasks.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-faint uppercase tracking-wider border-b border-line bg-nav">
              Running
            </div>
            {runningTasks.map(renderTask)}
          </>
        )}
        {finishedTasks.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] font-medium text-faint uppercase tracking-wider border-b border-line bg-nav">
              Finished
            </div>
            {finishedTasks.map(renderTask)}
          </>
        )}
      </div>

      {!readonly && (
        <form onSubmit={handleSubmit} className="shrink-0 border-t border-line bg-page p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Run a command..."
              className="flex-1 min-w-0 bg-control border border-strong rounded-md px-3 py-2 text-sm text-fg placeholder-faint focus:outline-none focus:ring-2 focus:ring-track/40 font-mono"
            />
            <button type="submit" className={`${NEUTRAL_BUTTON_CLASS} shrink-0`}>
              Run
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
