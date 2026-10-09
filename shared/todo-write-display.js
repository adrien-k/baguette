/** Stable key for collapsing duplicate TodoWrite tool_call rows in chat. */
function todoToolCallKey(msg) {
  return msg.call_id ?? `tool-${msg.id}`;
}

function trimContent(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** True when a typed todo tool_call has at least one non-empty todo line. */
export function todoToolCallHasVisibleContent(msg) {
  if (msg?.type !== 'tool_call') return false;
  if (msg.name !== 'TodoWrite' && msg.kind !== 'todo') return false;
  const todos = msg.args?.todos;
  if (!Array.isArray(todos)) return false;
  return todos.some((t) => trimContent(t?.content));
}

/**
 * Hide redundant TodoWrite rows: status-only TaskUpdate patches (empty content)
 * and older todo snapshots when a later row has visible todos.
 */
export function applyTodoWriteCollapse(messages) {
  let lastVisibleTodoKey = null;
  for (const msg of messages) {
    if (msg.type === 'tool_call' && (msg.name === 'TodoWrite' || msg.kind === 'todo')) {
      if (todoToolCallHasVisibleContent(msg)) {
        lastVisibleTodoKey = todoToolCallKey(msg);
      }
    }
  }

  return messages.map((msg) => {
    if (msg.type !== 'tool_call' || (msg.name !== 'TodoWrite' && msg.kind !== 'todo')) {
      return msg;
    }
    if (!todoToolCallHasVisibleContent(msg)) {
      return { ...msg, _hidden: true };
    }
    if (lastVisibleTodoKey && todoToolCallKey(msg) !== lastVisibleTodoKey) {
      return { ...msg, _hidden: true };
    }
    return msg;
  });
}
