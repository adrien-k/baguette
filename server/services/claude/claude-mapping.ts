/**
 * Claude Agent SDK → canonical Baguette messages.
 *
 * This module is the ONLY place that knows what a Claude SDK message looks
 * like. It answers, explicitly and exhaustively, the question "what does a
 * Claude `<type>`/`<subtype>` become?" — every branch produces `MessageOp`
 * values, and the writer turns ops into rows.
 *
 * The SDK message union is taken from `@anthropic-ai/claude-agent-sdk` so each
 * branch can narrow on the specific variant type. A future SDK rename or new
 * subtype is caught at compile time.
 *
 * Note on `type: 'system'`: many SDK variants share this tag and discriminate
 * on `subtype` (init, status, thinking_tokens, task_started, …). We switch on
 * the full union, then on `subtype` for the system bucket.
 */

import type {
  BetaContentBlock,
  BetaMessage,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKStatusMessage,
  SDKSystemMessage,
  SDKThinkingTokensMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { planMarkdownFromToolInput } from '../../../shared/plan-markdown.ts';
import type {
  AnyToolResult,
  MessageOp,
  ToolArgsByKind,
  ToolCallKind,
  ToolCallPayload,
  ToolResultBase,
} from '../../../shared/message-types.ts';
import { formatClaudeToolResult } from './claude-tool-result.js';
import {
  hasNonemptyToolInput,
  mergeToolCallInput,
  toolInputFromPayload,
} from '../../../shared/merge-tool-call-input.js';

export type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/** Tool names that produce a `plan` row rather than a tool_call row. */
const PLAN_TOOL_NAMES = new Set(['ExitPlanMode', 'createPlan']);

/**
 * Claude's task-tracker tools map to the canonical `TodoWrite` name so the
 * shared `toolKindFromName` vocabulary treats them as `todo` rows.
 */
const TASK_TRACKER_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList']);

export function isClaudePlanTool(name?: string | null): boolean {
  return PLAN_TOOL_NAMES.has(name ?? '');
}

export function isClaudeTaskTrackerTool(name?: string | null): boolean {
  return TASK_TRACKER_TOOL_NAMES.has(name ?? '');
}

/** Claude Agent SDK registers the shell tool as lowercase `bash`. */
const CLAUDE_TOOL_ALIAS: Record<string, string> = {
  bash: 'Bash',
  shell: 'Bash',
};

/**
 * Translate Claude-native tool names into the canonical vocabulary the rest of
 * the codebase consumes. MCP tool names are kept verbatim since they carry
 * the provider's namespace.
 */
export function canonicalizeClaudeToolName(name: string): string {
  if (!name) return name;
  if (name.startsWith('mcp__')) return name;
  if (TASK_TRACKER_TOOL_NAMES.has(name)) return 'TodoWrite';
  const alias = CLAUDE_TOOL_ALIAS[name.toLowerCase()];
  if (alias) return alias;
  return name;
}

/**
 * `true` when a user message carries real human text rather than tool results.
 *
 * The Claude SDK can submit user-role content that is *either* a human prompt
 * (string or text-only array) *or* a tool_result carrier (array containing
 * `tool_result` blocks). We only want to persist the former.
 */
export function isClaudeHumanUserMessage(msg: SDKMessage): boolean {
  if (msg.type !== 'user') return false;
  const userMsg = msg as SDKUserMessage;
  const content = userMsg.message.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) {
    return !content.some((b) => b.type === 'tool_result');
  }
  return false;
}

/** Parse the JSON-ish content of a `tool_result` block. */
function toolResultContent(content: BetaToolResultBlockParam['content']): unknown {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return '';
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return content;
    }
  }
  // Claude's structured result blocks: [{ type: 'text', text }, …]
  if (Array.isArray(content)) {
    return content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return content;
}

/** Map one assistant content block to zero or one op. */
function mapAssistantBlock(block: BetaContentBlock): MessageOp | null {
  switch (block.type) {
    case 'text':
      return { op: 'assistant_text', text: block.text };
    case 'thinking':
      return { op: 'assistant_thinking', text: block.thinking };
    case 'tool_use': {
      // Claude delivers a plan as a tool_use; Baguette stores it as a plan
      // row, never a tool_call row.
      if (isClaudePlanTool(block.name)) {
        const markdown = planMarkdownFromToolInput(block.input);
        if (!markdown) return null;
        return { op: 'plan', markdown };
      }
      return {
        op: 'tool_start',
        call_id: block.id,
        name: canonicalizeClaudeToolName(block.name),
        input: asInput(block.input),
      };
    }
    default:
      return null;
  }
}

/** Coerce an SDK `BetaToolUseBlock.input` (typed as `unknown`) to a record. */
function asInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function mapAssistant(message: BetaMessage): MessageOp[] | null {
  const ops: MessageOp[] = [];
  for (const block of message.content) {
    const mapped = mapAssistantBlock(block);
    if (mapped) ops.push(mapped);
  }
  return ops.length > 0 ? ops : null;
}

function mapUser(msg: SDKUserMessage): MessageOp[] | null {
  const content = msg.message.content;
  if (!Array.isArray(content)) return null;
  const ops: MessageOp[] = [];
  for (const block of content) {
    if (block.type !== 'tool_result') continue;
    ops.push({
      op: 'tool_result',
      call_id: block.tool_use_id,
      raw: toolResultContent(block.content),
      is_error: Boolean(block.is_error),
    });
  }
  return ops.length > 0 ? ops : null;
}

/**
 * Map a `type: 'system'` SDK message.
 *
 * Many SDK variants share this tag. Subtype picks the variant. We return
 * `null` for control-flow subtypes (`init`, `task_started`,
 * `task_notification`, …) that drive the turn controller, not the transcript.
 */
function mapSystemVariant(msg: SDKMessage): MessageOp[] | null {
  if (msg.type !== 'system') return null;
  switch (msg.subtype) {
    case 'thinking_tokens':
      return thinkingTokensOp(msg);
    case 'status':
      return statusOp(msg);
    default:
      return null;
  }
}

function thinkingTokensOp(msg: SDKThinkingTokensMessage): MessageOp[] {
  return [
    {
      op: 'system',
      payload: {
        type: 'system',
        subtype: 'thinking_tokens',
        estimated_tokens: msg.estimated_tokens,
        estimated_tokens_delta: msg.estimated_tokens_delta,
      },
    },
  ];
}

function statusOp(msg: SDKStatusMessage): MessageOp[] | null {
  if (!msg.status) return null;
  return [{ op: 'system', payload: { type: 'system', subtype: 'status', status: msg.status } }];
}

function mapResult(msg: SDKResultMessage): MessageOp[] {
  if (msg.subtype === 'success') {
    if (msg.is_error) {
      return [turnResult('error', msg.result || 'Turn failed', msg.total_cost_usd)];
    }
    return [turnResult('ok', null, msg.total_cost_usd)];
  }
  // Error variants carry `errors: string[]`. Use the first entry, falling back
  // to a generic message when the array is empty.
  const detail = msg.errors[0] ?? null;
  return [turnResult('error', detail ?? 'Turn failed', msg.total_cost_usd)];
}

function turnResult(
  status: 'ok' | 'error',
  error_message: string | null,
  total_cost_usd: number
): MessageOp {
  return {
    op: 'turn_result',
    payload: {
      type: 'turn_result',
      status,
      error_message: status === 'ok' ? null : error_message,
      total_cost_usd,
    },
  };
}

/**
 * Map one Claude SDK message to canonical ops.
 *
 * Returns `null` for messages that carry no user-visible content (replays,
 * tool results for calls we never saw start, unknown types).
 */
export function mapClaudeMessage(msg: SDKMessage): MessageOp[] | null {
  // Replays re-deliver already-persisted messages; re-writing them would duplicate rows.
  if ('isReplay' in msg && (msg as { isReplay?: boolean }).isReplay) return null;

  switch (msg.type) {
    case 'assistant':
      return mapAssistant(msg.message);
    case 'user':
      return mapUser(msg);
    case 'system':
      return mapSystemVariant(msg);
    case 'result':
      return mapResult(msg);
    case 'stream_event':
      return mapClaudeStreamEvent(msg as SDKPartialAssistantMessage);
    default:
      return null;
  }
}

/** Map Claude partial stream frames into tool input merge ops. */
function mapClaudeStreamEvent(msg: SDKPartialAssistantMessage): MessageOp[] | null {
  const ev = msg.event;
  if (ev.type === 'content_block_start') {
    const block = ev.content_block;
    if (block.type === 'tool_use') {
      return [
        {
          op: 'tool_stream_block_start',
          index: ev.index,
          call_id: block.id,
          name: canonicalizeClaudeToolName(block.name),
          input: asInput(block.input),
        },
      ];
    }
    return null;
  }
  if (ev.type === 'content_block_delta' && ev.delta.type === 'input_json_delta') {
    return [
      {
        op: 'tool_stream_input_delta',
        index: ev.index,
        partial_json: ev.delta.partial_json,
      },
    ];
  }
  return null;
}

/** Type guard for assistant messages, used by downstream consumers. */
export function isClaudeAssistantMessage(msg: SDKMessage): msg is SDKAssistantMessage {
  return msg.type === 'assistant';
}

/** Type guard for the system init message. */
export function isClaudeSystemInit(msg: SDKMessage): msg is SDKSystemMessage {
  return msg.type === 'system' && msg.subtype === 'init';
}

/** Extract the plan markdown from an assistant message's plan tool_use block. */
export function claudePlanFromMessage(msg: SDKAssistantMessage): string | null {
  for (const block of msg.message.content) {
    if (block.type === 'tool_use' && isClaudePlanTool(block.name)) {
      const markdown = planMarkdownFromToolInput(block.input);
      if (markdown) return markdown;
    }
  }
  return null;
}

// ─── Claude tool-call payload builders ───────────────────────────────────────
//
// These build the running and terminal `ToolCallPayload` shapes. The shared
// `MessageStreamWriter` calls them via the `buildToolCallStart` /
// `buildToolCallComplete` injected at construction (see
// `server/services/message-writer-factory.ts`).
//
// `claudeCanonicalToolName` is the canonical-name entrypoint for Claude — it
// runs `canonicalizeClaudeToolName` (which folds `TaskCreate`/`TaskUpdate`/
// `TaskList` into `TodoWrite`) and falls back to `'generic'` for empty input.
// `claudeToolKindFromName` then resolves the closed `ToolCallKind` vocabulary
// for Claude tools.

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Canonical name for a Claude tool. */
export function claudeCanonicalToolName(name: string | null | undefined): string {
  const canonicalized = canonicalizeClaudeToolName(name ?? '');
  return canonicalized || 'generic';
}

/**
 * Resolve a canonical Claude tool name to exactly one `ToolCallKind`.
 *
 * Names reach this function already canonicalised by `canonicalizeClaudeToolName`
 * (`TaskCreate` → `TodoWrite`, etc.). Unrecognised names land as `generic`
 * so the raw name is never lost.
 */
export function claudeToolKindFromName(name: string | null | undefined): ToolCallKind {
  const n = claudeCanonicalToolName(name);
  if (n === 'Bash') return 'bash';
  if (n === 'Read') return 'read';
  if (n === 'Delete') return 'delete';
  if (n === 'Glob') return 'glob';
  if (n === 'Grep') return 'grep';
  if (n === 'Write') return 'write';
  if (n === 'Edit') return 'edit';
  if (n === 'TodoWrite') return 'todo';
  if (n === 'Task' || n === 'Agent') return 'task';
  if (n === 'AskUserQuestion') return 'ask_user';
  if (n === 'ExitPlanMode' || n === 'createPlan') return 'exit_plan';
  if (n === 'mcp' || n.startsWith('mcp__')) return 'mcp';
  return 'generic';
}

/** Strip up to 4 levels of `{ input: { input: … } }` legacy wrapping. */
function unwrapNestedToolInput(input: unknown): Dict {
  let cur: unknown = input ?? {};
  for (let i = 0; i < 4; i++) {
    if (
      isDict(cur) &&
      isDict(cur.input) &&
      cur.subject == null &&
      cur.taskId == null &&
      cur.status == null
    ) {
      cur = cur.input;
      continue;
    }
    break;
  }
  return isDict(cur) ? cur : {};
}

/** Normalise raw Claude tool input into typed `args` for `kind`. */
export function mapClaudeToolArgs<K extends ToolCallKind>(
  kind: K,
  toolName: string,
  input: Dict = {}
): ToolArgsByKind[K] {
  const inp = input ?? {};
  switch (kind) {
    case 'bash': {
      const unwrapped = unwrapNestedToolInput(inp);
      const command = str(unwrapped.command ?? unwrapped.cmd ?? inp.command ?? inp.cmd);
      const description = strOrNull(unwrapped.description ?? inp.description);
      return {
        command,
        ...(description ? { description } : {}),
      } as ToolArgsByKind[K];
    }
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
    case 'todo': {
      if (Array.isArray(inp.todos)) return { todos: inp.todos as Dict[] } as ToolArgsByKind[K];
      const inner = unwrapNestedToolInput(inp);
      // Single-todo update — three input shapes land here:
      //   - Claude's newer TodoWrite emits { content, status, activeForm }
      //     directly instead of an enclosing array.
      //   - TaskCreate emits { subject, description, activeForm? }.
      //   - TaskUpdate patches a task by id and may carry { subject? } and/or
      //     { description? } to retitle it.
      // Concatenate subject + description so TaskCreate / TaskUpdate render
      // the full task text instead of dropping the description. Default to an
      // empty string (never the tool name) so a malformed payload never leaks
      // the literal "TodoWrite" placeholder into the chat row.
      const contentFromFlat = str(inner.content, '');
      const subject = str(inner.subject, '');
      const description = str(inner.description, '');
      const subjectDescription = (() => {
        if (subject && description) return `${subject}: ${description}`;
        return subject || description;
      })();
      const content = contentFromFlat || subjectDescription;
      return {
        todos: [
          {
            content,
            status: str(inner.status ?? 'pending'),
            activeForm: str(inner.activeForm ?? inner.active_form ?? content),
          },
        ],
      } as ToolArgsByKind[K];
    }
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
      const short = toolName.replace('mcp__baguette__', '');
      const { tool, ...rest } = inp;
      return { tool: str(tool ?? short), ...rest } as ToolArgsByKind[K];
    }
    default:
      return {
        label: toolName,
        detail: strOrNull(inp.command ?? inp.description),
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
 * Reduce a Claude shell/bash result to the typed `bash` result.
 *
 * Claude returns the bash payload as a plain `{exitCode, stdoutLines,
 * stderrLines}` (or `{stdout, stderr}`) shape, plus the canonical
 * `status: 'error' / 'success'` envelope when wrapped by MCP.
 */
export function mapClaudeBashToolResult(
  raw: unknown,
  opts: { isError?: boolean } = {}
): ToolResultByKindBash {
  let exitCode = opts.isError ? 1 : 0;
  let stdout = '';
  let stderr = '';

  if (raw === undefined || raw === null)
    return { status: 'ok', error_message: null, exit_code: exitCode, stdout, stderr };

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim())
      return { status: 'ok', error_message: null, exit_code: exitCode, stdout, stderr };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'ok', error_message: null, exit_code: 0, stdout: raw, stderr: '' };
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

  // Success envelopes nest the real payload under `value`.
  if (parsed.status === 'success' && isDict(parsed.value)) parsed = parsed.value;

  const out: Dict = isDict(parsed) ? parsed : {};
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
 * Normalise a Claude tool result into the typed result for `kind`.
 *
 * MCP / generic content reduction uses Claude-specific `formatClaudeToolResult`
 * (which knows Claude's `[{type:'text', text}]` envelope); bash, edit, and
 * task kinds use their own reducers.
 */
export function mapClaudeToolResult(
  kind: ToolCallKind,
  rawResult: unknown,
  opts: { isError?: boolean } = {}
): AnyToolResult {
  const isError = Boolean(opts.isError);

  if (kind === 'bash') return mapClaudeBashToolResult(rawResult, { isError }) as AnyToolResult;

  if (kind === 'edit') {
    let diff: string | null = null;
    if (isDict(rawResult)) {
      const v = isDict(rawResult.value) ? rawResult.value : rawResult;
      diff = strOrNull((v as Dict).diffString ?? (v as Diff).diff);
    }
    const { content } = formatClaudeToolResult(rawResult, { isError });
    return {
      status: isError ? 'error' : 'ok',
      error_message: isError ? content || 'Tool call failed' : null,
      diff,
    } as AnyToolResult;
  }

  if (kind === 'task') {
    const { content } = formatClaudeToolResult(rawResult, { isError });
    const summary = content || null;
    return {
      status: isError ? 'error' : 'ok',
      error_message: isError ? content || 'Tool call failed' : null,
      summary,
    } as AnyToolResult;
  }

  if (kind === 'mcp') {
    const { content } = formatClaudeToolResult(rawResult, { isError });
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
      status: isError ? 'error' : 'ok',
      error_message: isError ? content || 'Tool call failed' : null,
      content,
      data,
    } as AnyToolResult;
  }

  if (kind === 'generic') {
    const { content } = formatClaudeToolResult(rawResult, { isError });
    return {
      status: isError ? 'error' : 'ok',
      error_message: isError ? content || 'Tool call failed' : null,
      content,
    } as AnyToolResult;
  }

  const { content } = formatClaudeToolResult(rawResult, { isError });
  return {
    status: isError ? 'error' : 'ok',
    error_message: isError ? content || 'Tool call failed' : null,
  } as AnyToolResult;
}

type Diff = { diffString?: unknown; diff?: unknown };

/** Build the `running` half of a Claude tool call. */
export function claudeBuildToolCallStart(
  callId: string,
  name: string,
  args: Dict = {},
  startedAt: string = new Date().toISOString()
): ToolCallPayload {
  const canonical = claudeCanonicalToolName(name);
  const kind = claudeToolKindFromName(name);
  return {
    type: 'tool_call',
    id: callId,
    kind,
    name: canonical,
    status: 'running',
    started_at: startedAt,
    ended_at: null,
    result: null,
    args: mapClaudeToolArgs(kind, name, args),
  } as ToolCallPayload;
}

/**
 * Build the terminal half of a Claude tool call from its running form.
 *
 * `toolCallStatus` mirrors the SDK's verdict when supplied (`error` /
 * `cancelled`), so a run that reports `error` lands as such even if
 * `isError` was not set.
 */
export function claudeBuildToolCallComplete(
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
  const kind = claudeToolKindFromName(finalName);
  let status: ToolCallPayload['status'] = 'completed';
  if (isError || toolCallStatus === 'error') status = 'error';
  else if (toolCallStatus === 'cancelled') status = 'cancelled';

  const prevInput = toolInputFromPayload(prev);
  const mergedInput =
    args != null && hasNonemptyToolInput(args) ? mergeToolCallInput(prevInput, args) : prevInput;

  return {
    ...prev,
    kind,
    name: claudeCanonicalToolName(finalName),
    status,
    ended_at: endedAt ?? new Date().toISOString(),
    args: mapClaudeToolArgs(kind, finalName, mergedInput),
    result: mapClaudeToolResult(kind, rawResult, { isError }),
  } as ToolCallPayload;
}
