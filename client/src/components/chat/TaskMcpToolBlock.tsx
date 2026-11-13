import { ChevronDown, Loader2, Terminal } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { parseShellToolResult } from '../../utils/shellToolResult.js';
import { resolveOpenTaskFromMcpTool } from '../../utils/taskMcpTool.js';
import { formatToolInput, hasToolInput } from './QuietToolBlock.tsx';
import TerminalLogBlock from './TerminalLogBlock.tsx';
import ToolRunElapsed from './ToolRunElapsed.tsx';

type SessionTask = {
  id: number;
  label?: string | null;
  task_key?: string | null;
  status?: string;
  command?: string;
};

type McpResultData = Record<string, unknown> | null;

function formatRunTaskCommand(label: string, runArgs?: unknown) {
  const parts = Array.isArray(runArgs)
    ? runArgs.filter((a): a is string => typeof a === 'string')
    : [];
  return parts.length > 0 ? `${label} ${parts.join(' ')}` : label;
}

function toolErrorMessage(parsedResult: McpResultData) {
  if (typeof parsedResult?.error === 'string') return parsedResult.error;
  if (typeof parsedResult?.error_message === 'string') return parsedResult.error_message;
  return null;
}

function exitCodeClassName(exitCode: number | null) {
  if (exitCode == null || Number.isNaN(exitCode)) return 'text-faint font-mono';
  if (exitCode !== 0) return 'text-danger font-mono';
  return 'text-success font-mono';
}

function TaskOpenCard({
  label,
  taskId,
  canOpen,
  onOpen,
}: {
  label: string;
  taskId: number | null;
  canOpen: boolean;
  onOpen: (e: MouseEvent) => void;
}) {
  const cardBody = (
    <>
      <Terminal className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {taskId != null ? (
        <span className="font-mono text-[10px] text-faint shrink-0">#{taskId}</span>
      ) : null}
      <span className="truncate min-w-0">{label}</span>
    </>
  );

  if (!canOpen) {
    return (
      <div
        className="inline-flex max-w-[14rem] min-w-0 items-center gap-1.5 rounded-lg border border-line/80 bg-control/40 px-2.5 py-1.5 text-xs font-medium text-fg-muted"
        title={label}
      >
        {cardBody}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${label}`}
      className="inline-flex max-w-[14rem] min-w-0 items-center gap-1.5 rounded-lg border border-info/40 bg-info/10 px-2.5 py-1.5 text-xs font-medium text-info transition-colors hover:bg-info/20 hover:border-info/60 cursor-pointer"
    >
      {cardBody}
    </button>
  );
}

export default function TaskMcpToolBlock({
  toolName,
  args = {},
  result,
  parsedResult,
  isError = false,
  startedAt,
  tasks,
  onSelectTask,
}: {
  toolName: 'RunTask' | 'AwaitDetachedTask';
  args?: Record<string, unknown>;
  result?: unknown;
  parsedResult?: McpResultData;
  isError?: boolean;
  startedAt?: string | null;
  tasks?: SessionTask[];
  onSelectTask?: (taskId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const mcpFailed = parsedResult?.ok === false || parsedResult?.status === 'error';
  const showFailed = isError || mcpFailed;
  const mcpErrorMessage = toolErrorMessage(parsedResult ?? null);
  const isRunning = result == null && !showFailed;

  const openTask = useMemo(
    () =>
      resolveOpenTaskFromMcpTool(tasks, toolName, args, parsedResult ?? null, {
        isRunning,
      }) as SessionTask | null,
    [tasks, toolName, args, parsedResult, isRunning]
  );

  const labelFromArgs = typeof args.label === 'string' ? args.label : null;
  const runArgs = args.args;
  let detail: string | null = null;
  if (toolName === 'RunTask') {
    detail = formatRunTaskCommand(labelFromArgs ?? openTask?.label ?? 'RunTask', runArgs);
  } else if (args.taskId != null) {
    detail = `task #${String(args.taskId)}`;
  } else if (openTask?.id != null) {
    detail = `task #${openTask.id}`;
  }

  let cardLabel = 'Task';
  if (openTask?.label) cardLabel = openTask.label;
  else if (labelFromArgs) cardLabel = labelFromArgs;
  else if (openTask?.id != null) cardLabel = `Task #${openTask.id}`;
  const taskId = openTask?.id ?? null;
  const sessionHasTask = Boolean(taskId != null && tasks?.some((task) => task.id === taskId));
  const canOpen = Boolean(onSelectTask && sessionHasTask);
  const showTaskCard = openTask != null || (toolName === 'RunTask' && Boolean(labelFromArgs));

  const { exitCode, stdout, stderr } = useMemo(() => parseShellToolResult(result), [result]);
  const hasShellOutput = Boolean(stdout || stderr || (result != null && exitCode != null));
  const hasResultBody =
    showFailed || hasShellOutput || (parsedResult != null && result != null && !isRunning);
  const showExpandedBody = expanded && (hasToolInput(args) || hasResultBody);

  const handleOpen = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canOpen || taskId == null) return;
    onSelectTask?.(taskId);
  };

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${showFailed ? 'border-danger/60' : 'border-line'}`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 min-w-0">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
        >
          <span className="text-accent text-xs font-mono shrink-0">{toolName}</span>
          {detail ? (
            <span className="text-fg text-xs font-semibold truncate min-w-0">{detail}</span>
          ) : null}
          {showFailed && (
            <span className="shrink-0 text-danger text-xs font-medium bg-soft-danger px-1.5 py-0.5 rounded">
              error
            </span>
          )}
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-faint" aria-hidden />
          ) : (
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {isRunning && startedAt ? <ToolRunElapsed startedAt={startedAt} /> : null}
          {showTaskCard ? (
            <TaskOpenCard label={cardLabel} taskId={taskId} canOpen={canOpen} onOpen={handleOpen} />
          ) : null}
        </div>
      </div>
      {showExpandedBody && (
        <div className="border-t border-line px-3 sm:px-4 py-3 text-xs space-y-2">
          {hasToolInput(args) && (
            <div>
              <div className="text-faint font-medium mb-0.5">Input</div>
              <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-48">
                {formatToolInput(args)}
              </pre>
            </div>
          )}
          {mcpErrorMessage && (
            <div>
              {hasToolInput(args) && <div className="text-faint font-medium mb-0.5">Error</div>}
              <pre className="whitespace-pre-wrap overflow-auto max-h-40 rounded p-2 text-danger bg-soft-danger/60">
                {mcpErrorMessage}
              </pre>
            </div>
          )}
          {showFailed && !mcpErrorMessage && result != null && (
            <pre className="whitespace-pre-wrap overflow-auto max-h-40 rounded p-2 text-danger bg-soft-danger/60">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          )}
          {hasShellOutput && (
            <>
              <TerminalLogBlock text={stdout} />
              <TerminalLogBlock label="stderr" text={stderr} />
              {!isRunning && (
                <div className="flex items-baseline gap-2">
                  <span className="text-faint font-medium">Exit code</span>
                  <span className={exitCodeClassName(exitCode)}>
                    {exitCode != null && !Number.isNaN(exitCode) ? exitCode : '—'}
                  </span>
                </div>
              )}
            </>
          )}
          {!showFailed &&
            !hasShellOutput &&
            parsedResult != null &&
            result != null &&
            !isRunning && (
              <div>
                {hasToolInput(args) && <div className="text-faint font-medium mb-0.5">Result</div>}
                <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-48">
                  {JSON.stringify(parsedResult, null, 2)}
                </pre>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
