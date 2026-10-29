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

export function todoRefFromArgs(args: Record<string, unknown>): number | null {
  const nested = nestedToolArgs(args);
  const raw = args.ref ?? nested.ref;
  if (raw == null) return null;
  const ref = Number(raw);
  return Number.isInteger(ref) ? ref : null;
}

export function todoRefsFromArgs(args: Record<string, unknown>): number[] {
  const nested = nestedToolArgs(args);
  const raw = args.refs ?? nested.refs;
  if (!Array.isArray(raw)) return [];
  const refs: number[] = [];
  for (const item of raw) {
    const ref = Number(item);
    if (Number.isInteger(ref) && ref > 0 && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

const STATUS_ONLY_HEADING: Record<string, string> = {
  pending: 'Todo pending',
  in_progress: 'Todo in progress',
  completed: 'Todo completed',
};

function nestedField(args: Record<string, unknown>, key: string): unknown {
  const nested = nestedToolArgs(args);
  return args[key] ?? nested[key];
}

/** When UpdateTodo only changes status (no title/content), return a short chat heading. */
export function updateTodoStatusOnlyHeading(args: Record<string, unknown>): string | null {
  const status = nestedField(args, 'status');
  const title = nestedField(args, 'title');
  const content = nestedField(args, 'content');
  const hasTitle = typeof title === 'string' && title.trim();
  const hasContent = typeof content === 'string' && content.trim();
  if (hasTitle || hasContent) return null;
  if (typeof status !== 'string' || !STATUS_ONLY_HEADING[status]) return null;
  return STATUS_ONLY_HEADING[status];
}

/** @deprecated Use todoRefFromArgs */
export function todoIdFromArgs(args: Record<string, unknown>): number | null {
  return todoRefFromArgs(args);
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

export function todoTitleFromArgs(args: Record<string, unknown>): string | null {
  if (typeof args.title === 'string' && args.title.trim()) {
    return args.title.trim();
  }
  const nested = nestedToolArgs(args);
  const t = nested.title;
  if (typeof t === 'string' && t.trim()) return t.trim();
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
    const status =
      toolName === 'UpdateTodo' && fromResult.status ? fromResult.status : displayStatus;
    return { ...fromResult, status };
  }

  const fromList = todoFromTodosList(toolName, mcpResult);
  if (fromList) {
    return { ...fromList, status: displayStatus };
  }

  const content = todoContentFromArgs(args);
  const title = todoTitleFromArgs(args);
  if (toolName === 'CreateTodo' && content) {
    return { content, title: title ?? undefined, status: displayStatus };
  }

  return null;
}
