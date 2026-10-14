import { Link, useParams } from 'react-router-dom';
import { SessionTodoMarkdown, SessionTodoStatusBadge } from './SessionTodoList.tsx';
import { useFilterRoutes } from '../../hooks/useFilterRoutes.js';
import {
  resolveSessionTodoForTool,
  todoRefFromArgs,
  type McpTodoPayload,
} from '../../utils/sessionTodoMcpDisplay.ts';
import { sessionTodoTitle } from '../../utils/sessionTodoDisplay.ts';

const TOOL_HEADING: Record<string, string> = {
  CreateTodo: 'Todo created',
  ProcessTodo: 'Todo in progress',
  CompleteTodo: 'Todo completed',
};

const DISPLAY_STATUS: Record<string, string> = {
  CreateTodo: 'pending',
  ProcessTodo: 'in_progress',
  CompleteTodo: 'completed',
};

function SessionTodoStatusLine({
  toolName,
  args,
  result,
  isError = false,
}: {
  toolName: 'ProcessTodo' | 'CompleteTodo';
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}) {
  const { short_id } = useParams();
  const { sessionUrl } = useFilterRoutes();
  const isRunning = result == null;
  const ref = todoRefFromArgs(args);
  const heading = TOOL_HEADING[toolName] ?? toolName;
  const planTo =
    short_id != null
      ? `${sessionUrl(short_id)}?view=plan${ref != null ? `#todo-${ref}` : ''}`
      : null;

  return (
    <div className="text-xs font-mono py-0.5 pl-1 flex items-center gap-1.5 text-faint flex-wrap">
      <span>↳</span>
      <span className={isError ? 'text-red-700' : ''}>{heading}</span>
      {ref != null && <span className="text-faint tabular-nums">#{ref}</span>}
      {isError && <span className="text-red-700">[error]</span>}
      {isRunning && !isError && (
        <div className="w-2.5 h-2.5 border border-strong border-t-faint rounded-full animate-spin shrink-0" />
      )}
      {planTo && (
        <Link to={planTo} className="text-accent hover:underline shrink-0 normal-case">
          Todos
        </Link>
      )}
    </div>
  );
}

export default function SessionTodoToolBlock({
  toolName,
  args,
  mcpResult,
  result,
  isError = false,
}: {
  toolName: 'CreateTodo' | 'ProcessTodo' | 'CompleteTodo';
  args: Record<string, unknown>;
  mcpResult: McpTodoPayload | null;
  result?: unknown;
  isError?: boolean;
}) {
  if (toolName === 'ProcessTodo' || toolName === 'CompleteTodo') {
    return (
      <SessionTodoStatusLine toolName={toolName} args={args} result={result} isError={isError} />
    );
  }

  const isRunning = result == null;
  const todo = resolveSessionTodoForTool(toolName, args, mcpResult as McpTodoPayload | null);
  const heading = TOOL_HEADING[toolName] ?? toolName;
  const displayStatus = todo?.status ?? DISPLAY_STATUS[toolName] ?? 'pending';

  return (
    <div
      className={`rounded-lg border overflow-hidden ${isError ? 'border-danger/60' : 'border-line'}`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-line/60 bg-inset/40 flex-wrap">
        <span className="text-xs font-medium text-secondary">{heading}</span>
        {todo && (
          <span className="text-xs font-medium text-heading truncate max-w-[min(100%,20rem)]">
            {sessionTodoTitle(todo)}
          </span>
        )}
        <SessionTodoStatusBadge status={displayStatus} />
        {todo?.ref != null && <span className="text-[11px] font-mono text-faint">#{todo.ref}</span>}
        {isRunning && !isError && (
          <div className="w-3 h-3 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0 ml-auto" />
        )}
        {isError && <span className="text-danger text-xs font-medium ml-auto">error</span>}
      </div>
      <div className="px-3 sm:px-4 py-3">
        {todo?.content?.trim() ? (
          <SessionTodoMarkdown content={todo.content.trim()} />
        ) : isRunning ? (
          <p className="text-sm text-faint italic">Waiting for tool result…</p>
        ) : (
          <p className="text-sm text-faint italic">No todo content.</p>
        )}
      </div>
    </div>
  );
}
