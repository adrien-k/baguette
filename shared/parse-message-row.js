import { canonicalToolName, unwrapClaudeNestedToolInput } from './session-message-mappers.js';

/**
 * Merge DB row + message_json into a view model for ChatMessage.
 * Supports typed payloads and legacy SDK rows (until backfill completes).
 * @param {object} row
 */
export function parseMessageRow(row) {
  let payload;
  try {
    payload = JSON.parse(row.message_json || '{}');
  } catch {
    payload = {};
  }

  const base = { ...row, ...payload, id: row.id };

  if (payload.type === 'tool_call') {
    return {
      ...base,
      type: 'tool_call',
      tool_status: row.tool_status ?? payload.status,
      tool_started_at: row.tool_started_at ?? payload.started_at,
      tool_ended_at: row.tool_ended_at ?? payload.ended_at,
      block: toolCallToUiBlock(payload),
    };
  }

  if (payload.type === 'assistant' && Array.isArray(payload.blocks)) {
    return {
      ...base,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: payload.blocks.map((b) => {
          if (b.type === 'text') return { type: 'text', text: b.text };
          if (b.type === 'thinking') return { type: 'thinking', thinking: b.thinking };
          return b;
        }),
      },
    };
  }

  if (payload.type === 'user' && typeof payload.content === 'string') {
    return {
      ...base,
      type: 'user',
      source: payload.source,
      title: payload.title,
      subtype: row.subtype ?? payload.subtype,
      message: { role: 'user', content: payload.content },
    };
  }

  if (payload.type === 'plan' || row.type === 'plan') {
    return {
      ...base,
      type: 'plan',
      markdown: payload.markdown ?? '',
    };
  }

  if (payload.type === 'turn_result' || row.type === 'turn_result') {
    const ok = payload.status === 'ok';
    return {
      ...base,
      type: 'turn_result',
      subtype: ok ? 'success' : 'error',
      is_error: !ok,
      total_cost_usd: payload.total_cost_usd ?? row.total_cost_usd,
      result: payload.error_message,
    };
  }

  if (row.type === 'result') {
    return { ...base, type: 'turn_result', subtype: payload.subtype };
  }

  return base;
}

function toolCallToUiBlock(tc) {
  const isError = tc.status === 'error';
  const block = {
    type: 'tool_use',
    id: tc.id,
    name: tc.name,
    input: legacyInputFromArgs(tc.kind, tc.args),
    isError,
  };

  if (tc.result != null) {
    if (tc.kind === 'bash') {
      block.result = tc.result;
    } else if (tc.kind === 'edit' && tc.result.diff) {
      block.result = JSON.stringify({ value: { diffString: tc.result.diff } });
    } else if (tc.result.status === 'error') {
      block.result = tc.result.error_message ?? tc.result.content ?? '';
      block.isError = true;
    } else if (tc.kind === 'mcp' && tc.result.content) {
      block.result = tc.result.content;
    } else if (tc.kind === 'claude_task') {
      block.result = tc.result.summary ?? '';
    } else if (tc.result.content) {
      block.result = tc.result.content;
    } else {
      block.result = tc.result.summary ?? '';
    }
  }

  return block;
}

function legacyInputFromArgs(kind, args) {
  if (!args) return {};
  if (kind === 'bash') return { command: args.command };
  if (kind === 'read' || kind === 'write' || kind === 'edit' || kind === 'delete') {
    return {
      file_path: args.path,
      path: args.path,
      content: args.content,
      old_string: args.old_string,
      new_string: args.new_string,
    };
  }
  if (kind === 'glob') return { pattern: args.pattern, path: args.path };
  if (kind === 'grep') return { pattern: args.pattern, query: args.pattern, path: args.path };
  if (kind === 'todo') return { todos: args.todos };
  if (kind === 'task') return { description: args.description, subagent_type: args.subagent_type };
  if (kind === 'claude_task') {
    return {
      subject: args.subject,
      description: args.description,
      activeForm: args.active_form,
      taskId: args.task_id,
      status: args.status,
      tool: args.tool,
    };
  }
  if (kind === 'ask_user') return { questions: args.questions };
  if (kind === 'exit_plan') return { plan: args.plan };
  if (kind === 'mcp') {
    if (args.toolName) {
      const nested = args.args && typeof args.args === 'object' ? args.args : {};
      const { tool: _tool, ...rest } = nested;
      return rest;
    }
    if (args.tool) {
      const { tool: _tool, ...rest } = args;
      return rest;
    }
    return args;
  }
  return args.input ? unwrapClaudeNestedToolInput(args) : args;
}

export { canonicalToolName };
