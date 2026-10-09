import SessionTodoList from './SessionTodoList.tsx';

/** SDK TodoWrite / legacy todo tool rows in chat. */
export default function TodoBlock({ todos }: { todos?: unknown }) {
  return <SessionTodoList todos={todos} variant="compact" />;
}
