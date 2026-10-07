import { planMarkdownFromToolInput } from '../../../shared/plan-markdown.ts';
import type {
  AnyToolResult,
  MessageOp,
  ToolCallKind,
  ToolCallPayload,
} from '../../../shared/message-types.ts';
import {
  mapCursorToolArgs,
  mapCursorToolResult,
} from '../cursor/cursor-mapping.ts';

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

export function canonicalizePiToolName(name: string): string {
  if (!name) return name;
  if (name.startsWith('mcp__')) return name;
  return PI_TOOL_ALIAS[name] ?? name;
}

export function piToolKindFromName(canonicalName: string): ToolCallKind {
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

function turnResult(status: 'ok' | 'error', error_message: string | null): MessageOp[] {
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
    args: mapCursorToolArgs(kind, name, args),
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
    args: mapCursorToolArgs(kind, finalName, opts.args ?? (prev.args as Record<string, unknown>)),
    result: mapCursorToolResult(kind, opts.rawResult, {
      isError: opts.is_error,
    }) as AnyToolResult,
  } as ToolCallPayload;
}
