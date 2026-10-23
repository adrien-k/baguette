/** Chat display enrichments (TodoWrite collapse, sub-agent activity). */
export function enrichChatMessages(messages) {
  let lastTodoWriteKey = null;
  let lastTodoWriteBlock = null;
  for (const msg of messages) {
    if (msg.type === 'tool_call' && (msg.name === 'TodoWrite' || msg.kind === 'todo')) {
      lastTodoWriteKey = msg.call_id ?? `tool-${msg.id}`;
    }
    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        if (b.type === 'tool_use' && b.name === 'TodoWrite') lastTodoWriteBlock = b;
      }
    }
  }
  const withHiddenTodos =
    !lastTodoWriteBlock && !lastTodoWriteKey
      ? messages
      : messages.map((msg) => {
          if (msg.type === 'tool_call' && msg.name === 'TodoWrite' && lastTodoWriteKey) {
            const key = msg.call_id ?? `tool-${msg.id}`;
            if (key !== lastTodoWriteKey) return { ...msg, _hidden: true };
          }
          if (msg.type !== 'assistant' || !msg.message?.content) return msg;
          if (
            !msg.message.content.some(
              (b) => b.type === 'tool_use' && b.name === 'TodoWrite' && b !== lastTodoWriteBlock
            )
          )
            return msg;
          return {
            ...msg,
            message: {
              ...msg.message,
              content: msg.message.content.map((b) => {
                if (b.type === 'tool_use' && b.name === 'TodoWrite' && b !== lastTodoWriteBlock)
                  return { ...b, _hidden: true };
                return b;
              }),
            },
          };
        });

  const taskActivities = new Map();
  const SUB_AGENT_SYSTEM_SUBTYPES = new Set(['task_started', 'task_progress', 'task_notification']);

  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.parent_tool_use_id) {
      const key = msg.parent_tool_use_id;
      const lines = taskActivities.get(key) || [];
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          const detail =
            block.input?.command?.slice(0, 80) ||
            block.input?.file_path?.slice(0, 80) ||
            block.input?.pattern?.slice(0, 80) ||
            block.input?.description?.slice(0, 80) ||
            '';
          lines.push(detail ? `${block.name}: ${detail}` : block.name);
        }
      }
      taskActivities.set(key, lines);
    }
    if (msg.type === 'system' && msg.subtype === 'task_progress' && msg.tool_use_id) {
      const text = msg.summary || msg.description;
      if (text) {
        const lines = taskActivities.get(msg.tool_use_id) || [];
        lines.push(`[${text}]`);
        taskActivities.set(msg.tool_use_id, lines);
      }
    }
  }

  return withHiddenTodos
    .filter((msg) => {
      if (msg.type === 'tool_result_carrier') return false;
      if (msg._hidden) return false;
      if (msg.type === 'assistant' && msg.parent_tool_use_id) return false;
      if (msg.type === 'system' && SUB_AGENT_SYSTEM_SUBTYPES.has(msg.subtype)) return false;
      if (msg.type === 'tool_progress') return false;
      return true;
    })
    .map((msg) => {
      if (msg.type !== 'assistant' || !msg.message?.content || taskActivities.size === 0)
        return msg;
      const hasAgentBlock = msg.message.content.some(
        (b) => b.type === 'tool_use' && (b.name === 'Task' || b.name === 'Agent')
      );
      if (!hasAgentBlock) return msg;
      return {
        ...msg,
        message: {
          ...msg.message,
          content: msg.message.content.map((b) => {
            if (b.type !== 'tool_use' || (b.name !== 'Task' && b.name !== 'Agent')) return b;
            const activities = taskActivities.get(b.id);
            return activities?.length ? { ...b, agentActivities: activities } : b;
          }),
        },
      };
    });
}
