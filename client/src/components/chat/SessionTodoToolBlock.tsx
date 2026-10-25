import { Link, useParams } from 'react-router-dom';
import { SessionTodoMarkdown, SessionTodoStatusBadge } from './SessionTodoList.tsx';
import { useFilterRoutes } from '../../hooks/useFilterRoutes.js';
import {
  resolveSessionTodoForTool,
  todoRefFromArgs,
  todoRefsFromArgs,
  updateTodoStatusOnlyHeading,
  type McpTodoPayload,
} from '../../utils/sessionTodoMcpDisplay.ts';
import { sessionTodoTitle } from '../../utils/sessionTodoDisplay.ts';

const TOOL_HEADING: Record<string, string> = {
  CreateTodo: 'Todo created',
  UpdateTodo: 'Todo updated',
  DeleteTodo: 'Todos deleted',
};

const DISPLAY_STATUS: Record<string, string> = {
  CreateTodo: 'pending',
};

function SessionTodoStatusLine({
  toolName,
  args,
  result,
  showError = false,
  headingOverride,
  refs,
}: {
  toolName: 'UpdateTodo' | 'DeleteTodo';
  args: Record<string, unknown>;
  result?: unknown;
  showError?: boolean;
  headingOverride?: string;
  refs?: number[];
}) {
  const { short_id } = useParams();
  const { sessionUrl } = useFilterRoutes();
  const isRunning = result == null;
  const refList = refs ?? (todoRefFromArgs(args) != null ? [todoRefFromArgs(args)!] : []);
  const heading = headingOverride ?? TOOL_HEADING[toolName] ?? toolName;
  const firstRef = refList[0];
  const planTo =
    short_id != null
      ? `${sessionUrl(short_id)}?view=plan${firstRef != null ? `#todo-${firstRef}` : ''}`
      : null;

  return (
    <div className="text-xs font-mono py-0.5 pl-1 flex items-center gap-1.5 text-faint flex-wrap">
      <span>↳</span>
      <span className={showError ? 'text-red-700' : ''}>{heading}</span>
      {refList.map((ref) => (
        <span key={ref} className="text-faint tabular-nums">
          #{ref}
        </span>
      ))}
      {showError && <span className="text-red-700">[error]</span>}
      {isRunning && !showError && (
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
  toolName: 'CreateTodo' | 'UpdateTodo' | 'DeleteTodo';
  args: Record<string, unknown>;
  mcpResult: McpTodoPayload | null;
  result?: unknown;
  isError?: boolean;
}) {
  const toolFailed = mcpResult?.ok === false;
  const showError = isError || toolFailed;

  const statusOnlyHeading = toolName === 'UpdateTodo' ? updateTodoStatusOnlyHeading(args) : null;

  if (toolName === 'DeleteTodo') {
    return (
      <SessionTodoStatusLine
        toolName={toolName}
        args={args}
        result={result}
        showError={showError}
        refs={todoRefsFromArgs(args)}
      />
    );
  }

  if (toolName === 'UpdateTodo' && statusOnlyHeading) {
    return (
      <SessionTodoStatusLine
        toolName={toolName}
        args={args}
        result={result}
        showError={showError}
        headingOverride={statusOnlyHeading}
      />
    );
  }

  const isRunning = result == null;
  const todo = resolveSessionTodoForTool(toolName, args, mcpResult as McpTodoPayload | null);
  const heading = TOOL_HEADING[toolName] ?? toolName;
  const displayStatus = todo?.status ?? DISPLAY_STATUS[toolName] ?? 'pending';

  return (
    <div
      className={`rounded-lg border overflow-hidden ${showError ? 'border-danger/60' : 'border-line'}`}
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
        {isRunning && !showError && (
          <div className="w-3 h-3 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0 ml-auto" />
        )}
        {showError && <span className="text-danger text-xs font-medium ml-auto">error</span>}
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
