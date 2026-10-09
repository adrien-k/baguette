import { SessionTodoMarkdown, SessionTodoStatusBadge } from './SessionTodoList.tsx';
import {
  resolveSessionTodoForTool,
  type McpTodoPayload,
} from '../../utils/sessionTodoMcpDisplay.ts';

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

export { resolveSessionTodoForTool } from '../../utils/sessionTodoMcpDisplay.ts';

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
  const isRunning = result == null;
  const todo = resolveSessionTodoForTool(toolName, args, mcpResult as McpTodoPayload | null);
  const heading = TOOL_HEADING[toolName] ?? toolName;
  const displayStatus = todo?.status ?? DISPLAY_STATUS[toolName] ?? 'pending';

  return (
    <div
      className={`rounded-lg border overflow-hidden ${isError ? 'border-danger/60' : 'border-line'}`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-line/60 bg-inset/40">
        <span className="text-xs font-medium text-secondary">{heading}</span>
        <SessionTodoStatusBadge status={displayStatus} />
        {todo?.id != null && <span className="text-[11px] font-mono text-faint">#{todo.id}</span>}
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
