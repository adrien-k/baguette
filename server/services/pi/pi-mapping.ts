import { planMarkdownFromToolInput } from '../../../shared/plan-markdown.ts';
import type {
  AnyToolResult,
  MessageOp,
  ToolArgsByKind,
  ToolCallKind,
  ToolCallPayload,
  ToolResultByKind,
} from '../../../shared/message-types.ts';
import { mapCursorToolArgs, mapCursorToolResult } from '../cursor/cursor-mapping.ts';
import {
  baguetteMcpShortName,
  isBaguetteMcpToolName,
} from '../../../shared/baguette-mcp-tool-names.js';

const PI_TOOL_ALIAS: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  find: 'Glob',
  ls: 'Glob',
};

const PLAN_TOOL_NAMES = new Set(['createPlan', 'ExitPlanMode', 'exit_plan']);

function canonicalizePiToolName(name: string): string {
  if (!name) return name;
  if (name.startsWith('mcp__')) return name;
  return PI_TOOL_ALIAS[name] ?? name;
}

function piToolKindFromName(canonicalName: string): ToolCallKind {
  if (canonicalName === 'AskUserQuestions') return 'ask_user';
  const short = baguetteMcpShortName(canonicalName);
  if (short === 'AskUserQuestions') return 'ask_user';
  if (isBaguetteMcpToolName(canonicalName) || isBaguetteMcpToolName(short)) return 'mcp';
  const map: Record<string, ToolCallKind> = {
    Bash: 'bash',
    Read: 'read',
    Write: 'write',
    Edit: 'edit',
    Glob: 'glob',
    Grep: 'grep',
    Task: 'task',
    TodoWrite: 'todo',
    ExitPlanMode: 'exit_plan',
    createPlan: 'exit_plan',
  };
  if (canonicalName.startsWith('mcp__')) return 'mcp';
  return map[canonicalName] ?? 'mcp';
}

function asInput(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

function isDict(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  return String(value);
}

function strOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s === '' ? null : s;
}

/** Pi edit tools return unified diff text under `details.diff` (or `details.patch`). */
function piEditDiffFromResult(raw: unknown): string | null {
  if (!isDict(raw)) return null;
  const details = isDict(raw.details) ? raw.details : null;
  if (!details) return null;
  return strOrNull(details.diff ?? details.patch);
}

function mapPiEditToolArgs(input: Record<string, unknown>): ToolArgsByKind['edit'] {
  const path = str(input.path ?? input.file_path);
  // Pi's native shape is `edits[]` with oldText/newText; UI reads result.diff for that case.
  if (Array.isArray(input.edits) && input.edits.length > 0) {
    return { path, old_string: null, new_string: null };
  }
  return {
    path,
    old_string: strOrNull(input.oldText ?? input.old_string),
    new_string: strOrNull(input.newText ?? input.new_string),
  };
}

export function mapPiToolArgs<K extends ToolCallKind>(
  kind: K,
  toolName: string,
  input: Record<string, unknown> = {}
): ToolArgsByKind[K] {
  if (kind === 'edit') {
    return mapPiEditToolArgs(input) as ToolArgsByKind[K];
  }
  return mapCursorToolArgs(kind, toolName, input);
}

export function mapPiToolResult(
  kind: ToolCallKind,
  rawResult: unknown,
  opts: { isError?: boolean } = {}
): AnyToolResult {
  const result = mapCursorToolResult(kind, rawResult, opts);
  if (kind !== 'edit') return result;
  const piDiff = piEditDiffFromResult(rawResult);
  if (!piDiff) return result;
  const editResult = result as ToolResultByKind['edit'];
  if (editResult.diff) return result;
  return { ...editResult, diff: piDiff };
}

export function piTurnResultOps(status: 'ok' | 'error', error_message: string | null): MessageOp[] {
  return [
    {
      op: 'turn_result',
      payload: {
        type: 'turn_result',
        status,
        error_message: status === 'ok' ? null : error_message,
        total_cost_usd: 0,
      },
    },
  ];
}

function turnResult(status: 'ok' | 'error', error_message: string | null): MessageOp[] {
  return piTurnResultOps(status, error_message);
}

export function mapPiEvent(event: Record<string, unknown>): MessageOp[] | null {
  const type = event.type;
  if (type === 'message_update') {
    const inner = event.assistantMessageEvent as Record<string, unknown> | undefined;
    if (!inner) return null;
    if (inner.type === 'text_delta' && typeof inner.delta === 'string') {
      return [{ op: 'assistant_text', text: inner.delta }];
    }
    if (inner.type === 'thinking_delta' && typeof inner.delta === 'string') {
      return [{ op: 'assistant_thinking', text: inner.delta }];
    }
    return null;
  }

  if (type === 'tool_execution_start') {
    const callId = String(event.toolCallId ?? '');
    const name = canonicalizePiToolName(String(event.toolName ?? ''));
    if (PLAN_TOOL_NAMES.has(String(event.toolName ?? ''))) return null;
    return [{ op: 'tool_start', call_id: callId, name, input: asInput(event.args) }];
  }

  if (type === 'tool_execution_end') {
    const callId = String(event.toolCallId ?? '');
    const rawName = String(event.toolName ?? '');
    const name = canonicalizePiToolName(rawName);
    if (PLAN_TOOL_NAMES.has(rawName)) {
      const markdown = planMarkdownFromToolInput(asInput(event.args));
      if (!markdown) return null;
      return [{ op: 'plan', markdown }];
    }
    const result = event.result;
    return [
      {
        op: 'tool_result',
        call_id: callId,
        name,
        input: asInput(event.args),
        raw: result,
        is_error: Boolean(event.isError),
        status: event.isError ? 'error' : 'completed',
      },
    ];
  }

  if (type === 'auto_retry_end') {
    if (event.success === false) {
      const detail =
        typeof event.finalError === 'string'
          ? event.finalError
          : typeof event.errorMessage === 'string'
            ? event.errorMessage
            : 'Turn failed';
      return turnResult('error', detail);
    }
    return null;
  }

  if (type === 'agent_settled') {
    return turnResult('ok', null);
  }

  return null;
}

export function piBuildToolCallStart(
  callId: string,
  name: string,
  args: Record<string, unknown> = {},
  startedAt: string = new Date().toISOString()
): ToolCallPayload {
  const canonical = canonicalizePiToolName(name);
  const kind = piToolKindFromName(canonical);
  return {
    type: 'tool_call',
    id: callId,
    kind,
    name: canonical,
    status: 'running',
    started_at: startedAt,
    ended_at: null,
    result: null,
    args: mapPiToolArgs(kind, name, args),
  } as ToolCallPayload;
}

export function piBuildToolCallComplete(
  prev: ToolCallPayload,
  opts: {
    name?: string;
    args?: Record<string, unknown>;
    rawResult?: unknown;
    is_error?: boolean;
    toolCallStatus?: string;
    endedAt?: string;
  } = {}
): ToolCallPayload {
  const finalName = opts.name ?? prev.name;
  const kind = piToolKindFromName(canonicalizePiToolName(finalName));
  let status: ToolCallPayload['status'] = 'completed';
  if (opts.is_error || opts.toolCallStatus === 'error') status = 'error';
  else if (opts.toolCallStatus === 'cancelled') status = 'cancelled';

  return {
    ...prev,
    type: 'tool_call',
    id: prev.id,
    kind,
    name: canonicalizePiToolName(finalName),
    status,
    ended_at: opts.endedAt ?? new Date().toISOString(),
    args: mapPiToolArgs(kind, finalName, opts.args ?? (prev.args as Record<string, unknown>)),
    result: mapPiToolResult(kind, opts.rawResult, {
      isError: opts.is_error,
    }) as AnyToolResult,
  } as ToolCallPayload;
}
