import type { SessionTodoItem } from '../components/chat/SessionTodoList.tsx';

const DISPLAY_STATUS: Record<string, string> = {
  CreateTodo: 'pending',
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

function nestedToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const nested = args.input ?? args.arguments ?? args.params;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return {};
}

export function todoIdFromArgs(args: Record<string, unknown>): number | null {
  const raw = args.id ?? nestedToolArgs(args).id;
  if (raw == null) return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export function todoContentFromArgs(args: Record<string, unknown>): string | null {
  if (typeof args.content === 'string' && args.content.trim()) {
    return args.content.trim();
  }
  const nested = nestedToolArgs(args);
  const c = nested.content;
  if (typeof c === 'string' && c.trim()) return c.trim();
  return null;
}

function todoFromTodosList(
  toolName: string,
  mcpResult: McpTodoPayload | null
): SessionTodoItem | null {
  const todos = mcpResult?.todos;
  if (!Array.isArray(todos) || todos.length === 0) return null;

  if (toolName === 'CreateTodo') {
    const fromResult = asTodoItem(mcpResult?.todo);
    if (fromResult) return fromResult;
    return asTodoItem(todos[todos.length - 1]);
  }

  return null;
}

/** Resolve todo payload for CreateTodo chat blocks. */
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

  const fromList = todoFromTodosList(toolName, mcpResult);
  if (fromList) {
    return { ...fromList, status: displayStatus };
  }

  const content = todoContentFromArgs(args);
  if (toolName === 'CreateTodo' && content) {
    return { content, status: displayStatus };
  }

  return null;
}
