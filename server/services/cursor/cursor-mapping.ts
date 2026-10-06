/**
 * Cursor SDK → canonical Baguette messages.
 *
 * The Cursor counterpart to `claude-mapping.ts`, and the only module that
 * understands `run.stream()` events. Same contract: every Cursor event type
 * maps explicitly to zero or more `MessageOp` values.
 *
 * The one real behavioural difference from Claude: Cursor reports tool
 * lifecycle in a single event carrying a `status` (`running` | `completed` |
 * `error`) rather than a start event plus a separate result message. Both
 * collapse onto the same `tool_start` / `tool_result` ops.
 */

import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKStatusMessage,
  SDKSystemMessage,
  SDKTaskMessage,
  SDKThinkingMessage,
  SDKToolUseMessage,
  SDKUsageMessage,
  SDKUserMessageEvent,
} from '@cursor/sdk';
import { planMarkdownFromToolInput } from '../../../shared/plan-markdown.ts';
import type {
  AnyToolResult,
  MessageOp,
  ToolArgsByKind,
  ToolCallKind,
  ToolCallPayload,
  ToolResultBase,
} from '../../../shared/message-types.ts';

export type { SDKMessage } from '@cursor/sdk';

/**
 * Cursor names its tools in snake_case; map to the canonical PascalCase
 * vocabulary the rest of the codebase consumes (`Bash`, `Read`, `Write`, …).
 */
const CURSOR_TOOL_ALIAS: Record<string, string> = {
  shell: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Task',
  delete: 'Delete',
};

/**
 * Translate a Cursor-native tool name to the canonical name shared with
 * Claude (and persisted in `tool_call.name`). MCP tool names are kept verbatim
 * since they carry the provider's namespace.
 */
export function canonicalizeCursorToolName(name: string): string {
  if (!name) return name;
  if (name.startsWith('mcp__')) return name;
  return CURSOR_TOOL_ALIAS[name] ?? name;
}

/**
 * Cursor wraps command output in `{ status: 'success', value: { … } }`.
 * Unwrap it so downstream mappers see the payload directly.
 */
export function unwrapCursorResult(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw as { status?: unknown }).status === 'success' &&
    (raw as { value?: unknown }).value !== undefined
  ) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function mapAssistantContent(msg: SDKAssistantMessage): MessageOp[] | null {
  const ops: MessageOp[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') ops.push({ op: 'assistant_text', text: block.text });
  }
  return ops.length > 0 ? ops : null;
}

function mapToolUse(msg: SDKToolUseMessage): MessageOp[] | null {
  // Cursor reports the whole lifecycle on one event via `status`.
  const canonical = canonicalizeCursorToolName(msg.name);
  if (msg.status === 'running') {
    // Plan tools stream `running` repeatedly as args grow; the completed
    // event carries the final text, so we only start the row then.
    if (isCursorPlanTool(msg.name)) return null;
    return [{ op: 'tool_start', call_id: msg.call_id, name: canonical, input: asInput(msg.args) }];
  }

  if (isCursorPlanTool(msg.name)) {
    const markdown = planMarkdownFromToolInput(msg.args);
    if (!markdown) return null;
    return [{ op: 'plan', markdown }];
  }

  return [
    {
      op: 'tool_result',
      call_id: msg.call_id,
      name: canonical,
      input: asInput(msg.args),
      raw: unwrapCursorResult(msg.result),
      is_error: msg.status === 'error',
      status: msg.status,
    },
  ];
}

function mapSystem(msg: SDKSystemMessage): MessageOp[] | null {
  // `init` carries init info used by the turn controller, not the transcript.
  void msg;
  return null;
}

function mapStatus(msg: SDKStatusMessage): MessageOp[] | null {
  // `status` drives turn control flow in the service; not a transcript row.
  void msg;
  return null;
}

function mapTask(msg: SDKTaskMessage): MessageOp[] | null {
  return msg.text
    ? [{ op: 'system', payload: { type: 'system', subtype: 'status', status: msg.text } }]
    : null;
}

function mapThinking(msg: SDKThinkingMessage): MessageOp[] | null {
  return [{ op: 'assistant_thinking', text: msg.text }];
}

function mapUsage(msg: SDKUsageMessage): MessageOp[] | null {
  void msg;
  return null;
}

function mapUser(msg: SDKUserMessageEvent): MessageOp[] | null {
  // Cursor only emits user events for synthetic tool_result carriers; the
  // Baguette UI gets user messages directly from the chat input, not via the
  // SDK stream.
  void msg;
  return null;
}

function asInput(args: unknown): Record<string, unknown> {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

/**
 * Map one Cursor stream event to canonical ops.
 *
 * Returns `null` for events that carry no transcript content (`usage`,
 * `status` — both drive turn control flow in the service, not the rows).
 */
export function mapCursorEvent(sdkMsg: SDKMessage): MessageOp[] | null {
  switch (sdkMsg.type) {
    case 'system':
      return mapSystem(sdkMsg);
    case 'user':
      return mapUser(sdkMsg);
    case 'assistant':
      return mapAssistantContent(sdkMsg);
    case 'thinking':
      return mapThinking(sdkMsg);
    case 'tool_call':
      return mapToolUse(sdkMsg);
    case 'status':
      return mapStatus(sdkMsg);
    case 'request':
      // `request` is the CLI signalling it's about to make a request — nothing
      // for the transcript.
      return null;
    case 'task':
      return mapTask(sdkMsg);
    case 'usage':
      return mapUsage(sdkMsg);
    default: {
      // Exhaustive: the SDK union is closed.
      const _exhaustive: never = sdkMsg;
      void _exhaustive;
      return null;
    }
  }
}

/** Type guard for assistant messages, used by downstream consumers. */
export function isCursorAssistantMessage(msg: SDKMessage): msg is SDKAssistantMessage {
  return msg.type === 'assistant';
}

/** Type guard for tool-call events. */
export function isCursorToolUseMessage(msg: SDKMessage): msg is SDKToolUseMessage {
  return msg.type === 'tool_call';
}

/** Plan tool names, shared with the turn controller for pending-tool accounting. */
export function isCursorPlanTool(name?: string | null): boolean {
  return name === 'ExitPlanMode' || name === 'createPlan';
}

// ─── Cursor tool-call payload builders ───────────────────────────────────────
//
// These build the running and terminal `ToolCallPayload` shapes for the Cursor
// SDK. The shared `MessageStreamWriter` calls them via `buildToolCallStart` /
// `buildToolCallComplete` injected at construction (see
// `server/services/message-writer-factory.ts`).
//
// Cursor names tools in snake_case; `canonicalizeCursorToolName` has already
// translated `shell`→`Bash`, `read`→`Read`, etc. before any builder sees them.

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Canonical name for a Cursor tool after the snake_case→PascalCase alias. */
export function cursorCanonicalToolName(name: string | null | undefined): string {
  const canonicalized = canonicalizeCursorToolName(name ?? '');
  return canonicalized || 'generic';
}

/**
 * Resolve a canonical Cursor tool name to exactly one `ToolCallKind`.
 *
 * Names reach this function already canonicalised by `canonicalizeCursorToolName`.
 * Unrecognised names land as `generic` so the raw name is never lost.
 */
export function cursorToolKindFromName(name: string | null | undefined): ToolCallKind {
  const n = cursorCanonicalToolName(name);
  if (n === 'Bash') return 'bash';
  if (n === 'Read') return 'read';
  if (n === 'Delete') return 'delete';
  if (n === 'Glob') return 'glob';
  if (n === 'Grep') return 'grep';
  if (n === 'Write') return 'write';
  if (n === 'Edit') return 'edit';
  if (n === 'TodoWrite' || n === 'updateTodos') return 'todo';
  if (n === 'Task') return 'task';
  if (n === 'AskUserQuestion') return 'ask_user';
  if (n === 'ExitPlanMode' || n === 'createPlan') return 'exit_plan';
  if (n === 'mcp' || n.startsWith('mcp__')) return 'mcp';
  return 'generic';
}

/** Normalise raw Cursor tool input into typed `args` for `kind`. */
export function mapCursorToolArgs<K extends ToolCallKind>(
  kind: K,
  toolName: string,
  input: Dict = {}
): ToolArgsByKind[K] {
  const inp = input ?? {};
  switch (kind) {
    case 'bash':
      return { command: str(inp.command) } as ToolArgsByKind[K];
    case 'read':
    case 'delete':
      return { path: str(inp.path ?? inp.file_path) } as ToolArgsByKind[K];
    case 'write':
      return {
        path: str(inp.path ?? inp.file_path),
        content: str(inp.content ?? inp.newContent),
      } as ToolArgsByKind[K];
    case 'edit':
      return {
        path: str(inp.path ?? inp.file_path),
        old_string: strOrNull(inp.oldString ?? inp.old_string),
        new_string: strOrNull(inp.newString ?? inp.new_string),
      } as ToolArgsByKind[K];
    case 'glob':
      return {
        pattern: str(inp.pattern ?? inp.path),
        path: strOrNull(inp.path),
      } as ToolArgsByKind[K];
    case 'grep':
      return {
        pattern: str(inp.pattern ?? inp.query),
        path: strOrNull(inp.path),
      } as ToolArgsByKind[K];
    case 'todo':
      // Cursor's `updateTodos` tool is a single-subject payload; surface as a
      // one-element todos array so the rest of the pipeline sees a uniform
      // shape. Default content to an empty string (not the tool name) so a
      // malformed payload never renders as the literal "TodoWrite" placeholder.
      return {
        todos: [
          {
            content: str(inp.subject ?? inp.content ?? inp.description ?? '', ''),
            status: str(inp.status ?? 'pending'),
            activeForm: str(inp.activeForm ?? inp.active_form ?? ''),
          },
        ],
      } as ToolArgsByKind[K];
    case 'task':
      return {
        description: str(inp.description),
        subagent_type: strOrNull(inp.subagent_type ?? inp.subagentType),
      } as ToolArgsByKind[K];
    case 'ask_user':
      return { questions: (inp.questions as Dict[]) ?? [] } as ToolArgsByKind[K];
    case 'exit_plan':
      return { plan: str(inp.plan ?? inp.planContent) } as ToolArgsByKind[K];
    case 'mcp': {
      if (toolName === 'mcp') {
        const nested = isDict(inp.args) ? inp.args : {};
        const { toolName: toolNameField, args: _args, ...rest } = inp;
        const { tool, ...fields } = nested;
        return {
          tool: str(toolNameField ?? tool ?? 'mcp'),
          ...fields,
          ...(Object.keys(rest).length ? rest : {}),
        } as ToolArgsByKind[K];
      }
      const short = toolName.replace('mcp__baguette__', '');
      const { tool, ...rest } = inp;
      return { tool: str(tool ?? short), ...rest } as ToolArgsByKind[K];
    }
    default:
      return {
        label: toolName,
        detail: strOrNull(inp.description ?? inp.command),
        input: inp,
      } as ToolArgsByKind[K];
  }
}

type ToolResultByKindBash = ToolResultBase & {
  exit_code: number;
  stdout: string;
  stderr: string;
};

/**
 * Reduce a Cursor shell/bash result to the typed `bash` result.
 *
 * Cursor wraps command output in `{ status: 'success', value: { … } }` (or
 * `{ status: 'error', error: { message } }`); `unwrapCursorResult` strips the
 * success envelope so the field vocabulary after unwrapping matches Claude's.
 */
export function mapCursorBashToolResult(
  raw: unknown,
  opts: { isError?: boolean } = {}
): ToolResultByKindBash {
  let exitCode = opts.isError ? 1 : 0;
  let stdout = '';
  let stderr = '';

  if (raw === undefined || raw === null)
    return { status: 'ok', error_message: null, exit_code: exitCode, stdout, stderr };

  const unwrapped = unwrapCursorResult(raw);
  let parsed: unknown = unwrapped;
  if (typeof unwrapped === 'string') {
    if (!unwrapped.trim())
      return { status: 'ok', error_message: null, exit_code: exitCode, stdout, stderr };
    try {
      parsed = JSON.parse(unwrapped);
    } catch {
      return { status: 'ok', error_message: null, exit_code: 0, stdout: unwrapped, stderr: '' };
    }
  }

  if (!isDict(parsed)) {
    return { status: 'ok', error_message: null, exit_code: 0, stdout: String(parsed), stderr: '' };
  }

  if (parsed.status === 'error') {
    const err = parsed.error;
    stderr =
      typeof err === 'string'
        ? err
        : isDict(err) && typeof err.message === 'string'
          ? err.message
          : JSON.stringify(err ?? 'error');
    return { status: 'error', error_message: stderr, exit_code: 1, stdout, stderr };
  }

  const out: Dict = parsed;
  if (out.exitCode != null) exitCode = Number(out.exitCode);
  else if (out.exit_code != null) exitCode = Number(out.exit_code);

  if (Array.isArray(out.stdoutLines)) stdout = out.stdoutLines.join('\n');
  else if (out.stdout != null) stdout = String(out.stdout);
  else if (out.output != null) stdout = String(out.output);
  else if (out.interleavedOutput != null) stdout = String(out.interleavedOutput);

  if (Array.isArray(out.stderrLines)) stderr = out.stderrLines.join('\n');
  else if (out.stderr != null) stderr = String(out.stderr);

  if (!stdout && !stderr && typeof out.content === 'string') stdout = out.content;

  if (opts.isError && exitCode === 0) exitCode = 1;

  return {
    status: opts.isError ? 'error' : 'ok',
    error_message: opts.isError ? stderr || 'Tool call failed' : null,
    exit_code: Number.isNaN(exitCode) ? 1 : exitCode,
    stdout,
    stderr,
  };
}

/**
 * Reduce a raw tool result to plain text plus an error verdict.
 *
 * Cursor results come back as strings, arrays of text blocks, plain objects, or
 * JSON-stringified equivalents. The mapper handles every shape the SDK
 * actually produces; the caller passes `isError` so empty / absent results
 * surface the "Tool call failed" text only when the SDK marked the call failed.
 */
function cursorResultToText(raw: unknown, isError: boolean): { content: string; isError: boolean } {
  if (raw === undefined || raw === null) {
    return isError
      ? { content: 'Tool call failed', isError: true }
      : { content: '', isError: false };
  }
  if (typeof raw === 'string') {
    if (!raw.trim()) {
      return isError
        ? { content: 'Tool call failed', isError: true }
        : { content: '', isError: false };
    }
    return { content: raw, isError };
  }
  if (Array.isArray(raw)) {
    const text = raw
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        if (typeof (block as { text?: unknown }).text === 'string') {
          return (block as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
    if (text) return { content: text, isError };
    if (isError) return { content: 'Tool call failed', isError: true };
    return { content: '', isError: false };
  }
  if (typeof raw === 'object') {
    const obj = raw as Dict;
    if (typeof obj.text === 'string') return { content: obj.text, isError };
    try {
      return { content: JSON.stringify(raw, null, 2), isError };
    } catch {
      return { content: String(raw), isError };
    }
  }
  return { content: String(raw), isError };
}

/**
 * Normalise a Cursor tool result into the typed result for `kind`.
 *
 * Cursor results arrive already unwrapped from the `{status:'success',
 * value:{…}}` envelope by the upstream mapper (see `mapToolUse`); the typed
 * reducer handles the residual shape variance across SDKs.
 */
export function mapCursorToolResult(
  kind: ToolCallKind,
  rawResult: unknown,
  opts: { isError?: boolean } = {}
): AnyToolResult {
  const isError = Boolean(opts.isError);

  if (kind === 'bash') return mapCursorBashToolResult(rawResult, { isError }) as AnyToolResult;

  if (kind === 'edit') {
    let diff: string | null = null;
    if (isDict(rawResult)) {
      const v = isDict(rawResult.value) ? rawResult.value : rawResult;
      diff = strOrNull((v as Dict).diffString ?? (v as Diff).diff);
    }
    const { content, isError: contentIsError } = cursorResultToText(rawResult, isError);
    return {
      status: contentIsError ? 'error' : 'ok',
      error_message: contentIsError ? content || 'Tool call failed' : null,
      diff,
    } as AnyToolResult;
  }

  if (kind === 'task') {
    const { content, isError: contentIsError } = cursorResultToText(rawResult, isError);
    const summary = content || null;
    return {
      status: contentIsError ? 'error' : 'ok',
      error_message: contentIsError ? content || 'Tool call failed' : null,
      summary,
    } as AnyToolResult;
  }

  if (kind === 'mcp') {
    const { content, isError: contentIsError } = cursorResultToText(rawResult, isError);
    let data: Dict | null = null;
    if (typeof content === 'string' && content.trim().startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(content);
        if (isDict(parsed)) data = parsed;
      } catch {
        data = null;
      }
    }
    return {
      status: contentIsError ? 'error' : 'ok',
      error_message: contentIsError ? content || 'Tool call failed' : null,
      content,
      data,
    } as AnyToolResult;
  }

  if (kind === 'generic') {
    const { content, isError: contentIsError } = cursorResultToText(rawResult, isError);
    return {
      status: contentIsError ? 'error' : 'ok',
      error_message: contentIsError ? content || 'Tool call failed' : null,
      content,
    } as AnyToolResult;
  }

  const { content, isError: contentIsError } = cursorResultToText(rawResult, isError);
  return {
    status: contentIsError ? 'error' : 'ok',
    error_message: contentIsError ? content || 'Tool call failed' : null,
  } as AnyToolResult;
}

type Diff = { diffString?: unknown; diff?: unknown };

/** Build the `running` half of a Cursor tool call. */
export function cursorBuildToolCallStart(
  callId: string,
  name: string,
  args: Dict = {},
  startedAt: string = new Date().toISOString()
): ToolCallPayload {
  const canonical = cursorCanonicalToolName(name);
  const kind = cursorToolKindFromName(name);
  return {
    type: 'tool_call',
    id: callId,
    kind,
    name: canonical,
    status: 'running',
    started_at: startedAt,
    ended_at: null,
    result: null,
    args: mapCursorToolArgs(kind, name, args),
  } as ToolCallPayload;
}

/**
 * Build the terminal half of a Cursor tool call from its running form.
 *
 * `toolCallStatus` mirrors the SDK's verdict when supplied (`error` /
 * `cancelled`), so a run that reports `error` lands as such even if
 * `isError` was not set.
 */
export function cursorBuildToolCallComplete(
  prev: ToolCallPayload,
  {
    name,
    args,
    rawResult,
    isError,
    toolCallStatus,
    endedAt,
  }: {
    name?: string;
    args?: Dict;
    rawResult?: unknown;
    isError?: boolean;
    toolCallStatus?: string;
    endedAt?: string;
  }
): ToolCallPayload {
  const finalName = name ?? prev.name;
  const kind = cursorToolKindFromName(finalName);
  let status: ToolCallPayload['status'] = 'completed';
  if (isError || toolCallStatus === 'error') status = 'error';
  else if (toolCallStatus === 'cancelled') status = 'cancelled';

  return {
    ...prev,
    kind,
    name: cursorCanonicalToolName(finalName),
    status,
    ended_at: endedAt ?? new Date().toISOString(),
    args: mapCursorToolArgs(kind, finalName, args ?? (prev.args as Dict)),
    result: mapCursorToolResult(kind, rawResult, { isError }),
  } as ToolCallPayload;
}
