import type { SessionTodoItem } from '../components/chat/SessionTodoList.tsx';

const DISPLAY_STATUS: Record<string, string> = {
  CreateTodo: 'pending',
  ProcessTodo: 'in_progress',
  CompleteTodo: 'completed',
};

export type McpTodoPayload = {
  todo?: SessionTodoItem;
  todos?: SessionTodoItem[];
  ok?: boolean;
};

function asTodoItem(value: unknown): SessionTodoItem | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as SessionTodoItem;
  if (typeof t.content !== 'string' || !t.content.trim()) return null;
  return t;
}

export function todoContentFromArgs(args: Record<string, unknown>): string | null {
  if (typeof args.content === 'string' && args.content.trim()) {
    return args.content.trim();
  }
  const nested = args.input ?? args.arguments ?? args.params;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const c = (nested as { content?: unknown }).content;
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function todoFromTodosList(
  toolName: string,
  mcpResult: McpTodoPayload | null,
  args: Record<string, unknown>
): SessionTodoItem | null {
  const todos = mcpResult?.todos;
  if (!Array.isArray(todos) || todos.length === 0) return null;

  if (toolName === 'CreateTodo') {
    const fromResult = asTodoItem(mcpResult?.todo);
    if (fromResult) return fromResult;
    return asTodoItem(todos[todos.length - 1]);
  }

  const id = args.id != null ? Number(args.id) : null;
  if (id != null && Number.isInteger(id)) {
    const match = todos.find((t) => Number(t.id) === id);
    if (match) return asTodoItem(match) ?? null;
  }
  return null;
}

export function resolveSessionTodoForTool(
  toolName: string,
  args: Record<string, unknown>,
  mcpResult: McpTodoPayload | null
): SessionTodoItem | null {
  const displayStatus = DISPLAY_STATUS[toolName] ?? 'pending';

  const fromResult = asTodoItem(mcpResult?.todo);
  if (fromResult) {
    return { ...fromResult, status: displayStatus };
  }

  const fromList = todoFromTodosList(toolName, mcpResult, args);
  if (fromList) {
    return { ...fromList, status: displayStatus };
  }

  const content = todoContentFromArgs(args);
  if (toolName === 'CreateTodo' && content) {
    return { content, status: displayStatus };
  }

  if ((toolName === 'ProcessTodo' || toolName === 'CompleteTodo') && args.id != null) {
    const id = Number(args.id);
    return {
      id: Number.isInteger(id) ? id : undefined,
      content: content ?? `Todo #${args.id}`,
      status: displayStatus,
    };
  }

  return null;
}
