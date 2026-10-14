import type { SessionTodoItem } from '../components/chat/SessionTodoList.tsx';

/** First non-empty line of markdown content (legacy todos without `title`). */
function firstLineOfContent(content: string | undefined | null): string {
  if (!content) return '';
  const line = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? '';
}

/** Display title for a session todo row. */
export function sessionTodoTitle(todo: SessionTodoItem): string {
  const stored = typeof todo.title === 'string' ? todo.title.trim() : '';
  if (stored) return stored;
  return firstLineOfContent(todo.content);
}

export function sessionTodoHasBody(todo: SessionTodoItem): boolean {
  return Boolean(todo.content?.trim());
}
