import { formatClaudeToolResult } from './claude-tool-result.js';
import { formatCursorToolCallResult } from './cursor-tool-call-result.js';

const CLAUDE_TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList']);

/** Unwrap nested { input: { input: … } } from legacy generic tool arg storage. */
export function unwrapClaudeNestedToolInput(input) {
  let cur = input ?? {};
  for (let i = 0; i < 4; i++) {
    if (
      cur?.input &&
      typeof cur.input === 'object' &&
      cur.subject == null &&
      cur.taskId == null &&
      cur.status == null
    ) {
      cur = cur.input;
      continue;
    }
    break;
  }
  return cur;
}

const CURSOR_TOOL_ALIAS = {
  shell: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Task',
  delete: 'Delete',
};

/** @param {string} name */
export function canonicalToolName(name) {
  if (!name) return 'generic';
  if (name.startsWith('mcp__baguette__')) return name;
  if (name === 'mcp') return 'mcp';
  return CURSOR_TOOL_ALIAS[name] ?? name;
}

/** @param {string} name */
export function toolKindFromName(name) {
  const n = canonicalToolName(name);
  if (n === 'Bash' || n === 'shell') return 'bash';
  if (n === 'Read') return 'read';
  if (n === 'Delete') return 'delete';
  if (n === 'Glob' || n === 'ls') return 'glob';
  if (n === 'Grep' || n === 'semSearch') return 'grep';
  if (n === 'Write') return 'write';
  if (n === 'Edit') return 'edit';
  if (n === 'TodoWrite' || n === 'updateTodos') return 'todo';
  if (n === 'Task' || n === 'Agent') return 'task';
  if (CLAUDE_TASK_TOOLS.has(name)) return 'claude_task';
  if (n === 'AskUserQuestion') return 'ask_user';
  if (n === 'ExitPlanMode') return 'exit_plan';
  if (n === 'mcp' || n.startsWith('mcp__')) return 'mcp';
  return 'generic';
}

/** @returns {import('./session-messages.ts').GenericToolResult} */
export function genericOk() {
  return { status: 'ok', error_message: null };
}

/** @returns {import('./session-messages.ts').GenericToolResult} */
export function genericError(message) {
  return { status: 'error', error_message: message ?? 'Tool call failed' };
}

/**
 * @param {unknown} raw
 * @param {{ isError?: boolean }} [opts]
 * @returns {import('./session-messages.ts').BashToolResult}
 */
export function mapBashToolResult(raw, opts = {}) {
  let exitCode = opts.isError ? 1 : 0;
  let stdout = '';
  let stderr = '';

  if (raw === undefined || raw === null) {
    return { exit_code: exitCode, stdout, stderr };
  }

  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return { exit_code: exitCode, stdout, stderr };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { exit_code: 0, stdout: raw, stderr: '' };
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { exit_code: 0, stdout: String(parsed), stderr: '' };
  }

  if (parsed.status === 'error') {
    const err = parsed.error;
    stderr =
      typeof err === 'string'
        ? err
        : err?.message
          ? String(err.message)
          : JSON.stringify(err ?? 'error');
    return { exit_code: 1, stdout, stderr };
  }

  if (parsed.status === 'success' && parsed.value != null && typeof parsed.value === 'object') {
    parsed = parsed.value;
  }

  if (parsed.exitCode != null) exitCode = Number(parsed.exitCode);
  else if (parsed.exit_code != null) exitCode = Number(parsed.exit_code);

  if (Array.isArray(parsed.stdoutLines)) stdout = parsed.stdoutLines.join('\n');
  else if (parsed.stdout != null) stdout = String(parsed.stdout);
  else if (parsed.output != null) stdout = String(parsed.output);
  else if (parsed.interleavedOutput != null) stdout = String(parsed.interleavedOutput);

  if (Array.isArray(parsed.stderrLines)) stderr = parsed.stderrLines.join('\n');
  else if (parsed.stderr != null) stderr = String(parsed.stderr);

  if (!stdout && !stderr && typeof parsed.content === 'string') stdout = parsed.content;

  if (opts.isError && exitCode === 0) exitCode = 1;

  return { exit_code: Number.isNaN(exitCode) ? 1 : exitCode, stdout, stderr };
}

/**
 * @param {string} kind
 * @param {unknown} rawResult
 * @param {{ isError?: boolean; toolCallStatus?: string }} opts
 */
export function mapToolResultForKind(kind, rawResult, opts = {}) {
  if (kind === 'bash') {
    const { content, isError } =
      typeof rawResult === 'object' && rawResult !== null && !Array.isArray(rawResult)
        ? { content: rawResult, isError: opts.isError }
        : formatCursorToolCallResult(rawResult, {
            toolCallStatus: opts.toolCallStatus,
            isErrorHint: opts.isError,
          });
    if (typeof rawResult === 'string' || rawResult === null || rawResult === undefined) {
      return mapBashToolResult(rawResult, { isError: opts.isError || isError });
    }
    return mapBashToolResult(content, { isError: opts.isError || isError });
  }

  if (kind === 'edit') {
    let diff = null;
    if (rawResult && typeof rawResult === 'object') {
      const v = rawResult.value ?? rawResult;
      if (v?.diffString) diff = String(v.diffString);
    }
    const base = opts.isError
      ? genericError(
          typeof rawResult === 'string'
            ? rawResult
            : formatCursorToolCallResult(rawResult, opts).content
        )
      : genericOk();
    return { ...base, diff };
  }

  if (kind === 'task') {
    const text =
      typeof rawResult === 'string'
        ? rawResult
        : formatCursorToolCallResult(rawResult, opts).content;
    const base = opts.isError ? genericError(text) : genericOk();
    return { ...base, summary: text || null };
  }

  if (kind === 'claude_task') {
    const { content, isError } = formatClaudeToolResult(rawResult, { isError: opts.isError });
    const base = isError || opts.isError ? genericError(content) : genericOk();
    return { ...base, summary: content || null };
  }

  if (kind === 'mcp') {
    const claude = formatClaudeToolResult(rawResult, { isError: opts.isError });
    if (claude.content) {
      const base = claude.isError ? genericError(claude.content) : genericOk();
      let data = null;
      const content = claude.content;
      if (typeof content === 'string' && content.trim().startsWith('{')) {
        try {
          data = JSON.parse(content);
        } catch {
          data = null;
        }
      } else if (content && typeof content === 'object') {
        data = content;
      }
      return {
        ...base,
        content: claude.content,
        data: data && typeof data === 'object' ? data : null,
      };
    }
    const { content, isError } = formatCursorToolCallResult(rawResult, {
      toolCallStatus: opts.toolCallStatus,
      isErrorHint: opts.isError,
    });
    if (isError) return genericError(content);
    let data = null;
    if (typeof content === 'string' && content.trim().startsWith('{')) {
      try {
        data = JSON.parse(content);
      } catch {
        data = null;
      }
    } else if (content && typeof content === 'object') {
      data = content;
    }
    return { ...genericOk(), data: data && typeof data === 'object' ? data : null };
  }

  if (kind === 'generic') {
    const claude = formatClaudeToolResult(rawResult, { isError: opts.isError });
    if (claude.content) {
      const base = claude.isError ? genericError(claude.content) : genericOk();
      return { ...base, content: claude.content };
    }
    const { content, isError } = formatCursorToolCallResult(rawResult, {
      toolCallStatus: opts.toolCallStatus,
      isErrorHint: opts.isError,
    });
    if (content) {
      const base = isError ? genericError(content) : genericOk();
      return { ...base, content };
    }
    return isError ? genericError(content) : genericOk();
  }

  const { content, isError } = formatCursorToolCallResult(rawResult, {
    toolCallStatus: opts.toolCallStatus,
    isErrorHint: opts.isError,
  });
  return isError ? genericError(content) : genericOk();
}

/**
 * Normalize Cursor tool args to typed args bag.
 * @param {string} kind
 * @param {string} name
 * @param {Record<string, unknown>} input
 */
export function mapToolArgs(kind, name, input = {}) {
  const inp = input ?? {};
  if (kind === 'bash') {
    return { command: inp.command ?? '' };
  }
  if (kind === 'read' || kind === 'delete' || kind === 'write') {
    return {
      path: inp.path ?? inp.file_path ?? '',
      ...(kind === 'write' ? { content: inp.content ?? inp.newContent ?? '' } : {}),
    };
  }
  if (kind === 'edit') {
    return {
      path: inp.path ?? inp.file_path ?? '',
      old_string: inp.oldString ?? inp.old_string ?? null,
      new_string: inp.newString ?? inp.new_string ?? null,
    };
  }
  if (kind === 'glob') {
    return { pattern: inp.pattern ?? inp.path ?? '', path: inp.path ?? null };
  }
  if (kind === 'grep') {
    return {
      pattern: inp.pattern ?? inp.query ?? '',
      path: inp.path ?? null,
    };
  }
  if (kind === 'todo') {
    return { todos: inp.todos ?? [] };
  }
  if (kind === 'task') {
    return {
      description: inp.description ?? '',
      subagent_type: inp.subagent_type ?? null,
    };
  }
  if (kind === 'claude_task') {
    const inner = unwrapClaudeNestedToolInput(inp);
    return {
      tool: name,
      subject: inner.subject ?? null,
      description: inner.description ?? inner.detail ?? null,
      active_form: inner.activeForm ?? null,
      task_id: inner.taskId ?? null,
      status: inner.status ?? null,
    };
  }
  if (kind === 'ask_user') {
    return { questions: inp.questions ?? [] };
  }
  if (kind === 'exit_plan') {
    return { plan: inp.plan ?? inp.planContent ?? '' };
  }
  if (kind === 'mcp') {
    if (name === 'mcp') {
      const nested = inp.args && typeof inp.args === 'object' ? inp.args : {};
      return {
        tool: inp.toolName ?? nested.tool ?? 'mcp',
        ...nested,
      };
    }
    const short = name.replace('mcp__baguette__', '');
    const { tool, ...rest } = inp;
    return { tool: tool ?? short, ...rest };
  }
  return {
    label: name,
    detail: inp.description ?? inp.command ?? null,
    input: inp,
  };
}

/**
 * @param {string} callId
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {string} startedAt
 * @returns {import('./session-messages.ts').ToolCallPayload}
 */
export function buildToolCallStart(callId, name, args, startedAt = new Date().toISOString()) {
  const canonical = canonicalToolName(name);
  const kind = toolKindFromName(name);
  return {
    type: 'tool_call',
    id: callId,
    kind,
    name: canonical,
    status: 'running',
    started_at: startedAt,
    ended_at: null,
    result: null,
    args: mapToolArgs(kind, name, args),
  };
}

/**
 * @param {import('./session-messages.ts').ToolCallPayload} prev
 * @param {object} opts
 * @returns {import('./session-messages.ts').ToolCallPayload}
 */
export function buildToolCallComplete(
  prev,
  { name, args, rawResult, isError, toolCallStatus, endedAt }
) {
  const finalName = name ?? prev.name;
  const kind = toolKindFromName(finalName);
  let status = 'completed';
  if (isError || toolCallStatus === 'error') status = 'error';
  else if (toolCallStatus === 'cancelled') status = 'cancelled';
  return {
    ...prev,
    kind,
    name: canonicalToolName(finalName),
    status,
    ended_at: endedAt ?? new Date().toISOString(),
    args: mapToolArgs(kind, finalName, args ?? prev.args),
    result: mapToolResultForKind(kind, rawResult, { isError, toolCallStatus }),
  };
}

/**
 * Legacy client/API user JSON → typed user payload for storage.
 * @param {object} parsed
 */
export function normalizeUserPayloadForStorage(parsed) {
  if (parsed?.type === 'user' && (parsed.source === 'mcp' || parsed.subtype === 'mcp')) {
    if (typeof parsed.content === 'string') {
      return { type: 'user', source: 'mcp', content: parsed.content, subtype: 'mcp' };
    }
    const legacyContent = parsed.message?.content;
    let content = '';
    if (typeof legacyContent === 'string') content = legacyContent;
    else if (Array.isArray(legacyContent)) {
      content = legacyContent
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n\n');
    }
    return { type: 'user', source: 'mcp', content, subtype: 'mcp' };
  }
  if (parsed?.type === 'user' && typeof parsed.content === 'string') return parsed;
  if (parsed?.type !== 'user') return parsed;

  const legacyContent = parsed.message?.content;
  let content = '';
  if (typeof legacyContent === 'string') content = legacyContent;
  else if (Array.isArray(legacyContent)) {
    if (legacyContent.some((b) => b.type === 'tool_result')) {
      return { type: 'user', legacy_tool_result_carrier: true, content: '' };
    }
    content = legacyContent
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n');
  }

  const out = {
    type: 'user',
    content,
  };
  if (parsed.source === 'baguette' || parsed.subtype === 'baguette') {
    out.source = 'baguette';
    if (parsed.title) out.title = parsed.title;
    out.subtype = 'baguette';
  }
  return out;
}

/**
 * Claude SDK `result` → turn_result payload.
 * @param {object} message
 * @returns {import('./session-messages.ts').TurnResultPayload}
 */
export function mapClaudeTurnResult(message) {
  const ok = message.subtype === 'success' && !message.is_error;
  return {
    type: 'turn_result',
    status: ok ? 'ok' : 'error',
    error_message: ok ? null : String(message.result ?? message.error ?? 'Turn failed'),
    total_cost_usd: message.total_cost_usd ?? null,
  };
}

/**
 * Extract plan markdown from an ExitPlanMode / createPlan tool input.
 * @param {Record<string, unknown> | null | undefined} input
 */
export function planMarkdownFromToolInput(input) {
  if (!input || typeof input !== 'object') return '';
  for (const key of ['plan', 'planContent', 'description', 'content', 'text', 'summary']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  if (Array.isArray(input.allowedPrompts) && input.allowedPrompts.length > 0) {
    return `**Allowed actions:**\n\n${input.allowedPrompts.map((p) => `- ${p.prompt}`).join('\n')}`;
  }
  return '';
}

/**
 * Assistant SDK message → typed assistant payload.
 * @param {object} sdkMsg
 * @returns {{ blocks: import('./session-messages.ts').AssistantBlock[], toolUses: Array<{ id: string, name: string, input?: Record<string, unknown> }> }}
 */
export function mapClaudeAssistantPayload(sdkMsg) {
  const blocks = [];
  const toolUses = [];
  const content = sdkMsg.message?.content;
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'text') blocks.push({ type: 'text', text: b.text ?? '' });
      if (b.type === 'thinking') blocks.push({ type: 'thinking', thinking: b.thinking ?? '' });
      if (b.type === 'tool_use') toolUses.push(b);
    }
  }
  return { blocks, toolUses };
}
