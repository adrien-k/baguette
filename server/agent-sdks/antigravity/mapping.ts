/**
 * Antigravity ACP events → canonical Baguette `MessageOp` values & tool payloads.
 */

import type { SessionUpdate, ToolCallContent, ToolKind } from '@agentclientprotocol/sdk/unstable';
import { planMarkdownFromToolInput } from '../../../shared/plan-markdown.ts';
import type {
  AnyToolResult,
  MessageOp,
  ToolArgsByKind,
  ToolCallKind,
  ToolCallPayload,
  ToolResultByKind,
} from '../../../shared/message-types.ts';
import {
  baguetteMcpShortName,
  isBaguetteMcpToolName,
} from '../../../shared/baguette-mcp-tool-names.js';
import {
  mapCursorBashToolResult,
  mapCursorToolArgs,
  mapCursorToolResult,
} from '../cursor/mapping.ts';

type Dict = Record<string, unknown>;

const ANTIGRAVITY_TOOL_ALIAS: Record<string, string> = {
  run_command: 'Bash',
  bash: 'Bash',
  shell: 'Bash',
  read_file: 'Read',
  view_file: 'Read',
  read: 'Read',
  write_to_file: 'Write',
  write_file: 'Write',
  write: 'Write',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  edit_file: 'Edit',
  edit: 'Edit',
  find_by_name: 'Glob',
  list_dir: 'Glob',
  glob: 'Glob',
  find: 'Glob',
  ls: 'Glob',
  grep_search: 'Grep',
  grep: 'Grep',
  delete_file: 'Delete',
  delete: 'Delete',
  todo_write: 'TodoWrite',
  exit_plan_mode: 'ExitPlanMode',
};

const ACP_KIND_DEFAULT_NAME: Partial<Record<ToolKind, string>> = {
  execute: 'Bash',
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  search: 'Grep',
};

const PLAN_TOOL_NAMES = new Set([
  'createPlan',
  'create_plan',
  'ExitPlanMode',
  'exit_plan_mode',
  'exit_plan',
]);

const TERMINAL_TOOL_STATUSES = new Set(['completed', 'failed']);

function isDict(value: unknown): value is Dict {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asInput(value: unknown): Dict {
  return isDict(value) ? value : {};
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

/**
 * Translate an Antigravity ACP tool name into Baguette's canonical vocabulary
 * (`Bash`, `Read`, `mcp__baguette__<Short>`, …).
 *
 * `agy acp` registers our `'baguette'` HTTP MCP tools as `mcp_baguette_<Short>`
 * (single underscores), so normalize those back to `mcp__baguette__<Short>`.
 */
export function canonicalizeAntigravityToolName(name: string): string {
  if (!name) return name;
  if (name.startsWith('mcp__')) return name;
  if (name.startsWith('mcp_baguette_')) {
    return `mcp__baguette__${name.slice('mcp_baguette_'.length)}`;
  }
  return ANTIGRAVITY_TOOL_ALIAS[name] ?? name;
}

export function antigravityToolKindFromName(canonicalName: string): ToolCallKind {
  if (canonicalName === 'AskUserQuestion' || canonicalName === 'AskUserQuestions') {
    return 'ask_user';
  }
  const short = baguetteMcpShortName(canonicalName);
  if (short === 'AskUserQuestions') return 'ask_user';
  if (
    isBaguetteMcpToolName(canonicalName) ||
    isBaguetteMcpToolName(short) ||
    canonicalName.startsWith('mcp__') ||
    canonicalName.startsWith('mcp_')
  ) {
    return 'mcp';
  }
  const map: Record<string, ToolCallKind> = {
    Bash: 'bash',
    Read: 'read',
    Write: 'write',
    Edit: 'edit',
    Delete: 'delete',
    Glob: 'glob',
    Grep: 'grep',
    Task: 'task',
    TodoWrite: 'todo',
    ExitPlanMode: 'exit_plan',
    createPlan: 'exit_plan',
  };
  return map[canonicalName] ?? 'generic';
}

function resolveRawToolName(opts: {
  name?: string | null;
  title?: string | null;
  kind?: ToolKind | null;
}): string {
  if (typeof opts.name === 'string' && opts.name.trim()) return opts.name.trim();
  if (typeof opts.title === 'string' && opts.title.trim()) return opts.title.trim();
  if (opts.kind && ACP_KIND_DEFAULT_NAME[opts.kind]) {
    return ACP_KIND_DEFAULT_NAME[opts.kind] ?? 'generic';
  }
  return 'generic';
}

function antigravityEditOldNewStrings(inp: Dict): {
  old_string: string | null;
  new_string: string | null;
} {
  if (Array.isArray(inp.ReplacementChunks) && inp.ReplacementChunks.length > 0) {
    const first = isDict(inp.ReplacementChunks[0]) ? inp.ReplacementChunks[0] : {};
    return {
      old_string: strOrNull(first.TargetContent ?? first.old_string),
      new_string: strOrNull(first.ReplacementContent ?? first.new_string),
    };
  }
  return {
    old_string: strOrNull(inp.TargetContent ?? inp.oldString ?? inp.old_string ?? inp.oldText),
    new_string: strOrNull(inp.ReplacementContent ?? inp.newString ?? inp.new_string ?? inp.newText),
  };
}

export function mapAntigravityToolArgs<K extends ToolCallKind>(
  kind: K,
  toolName: string,
  input: Dict = {}
): ToolArgsByKind[K] {
  const canonical = canonicalizeAntigravityToolName(toolName);
  const inp = input ?? {};

  switch (kind) {
    case 'bash': {
      const command = str(inp.CommandLine ?? inp.command ?? inp.cmd);
      const description = strOrNull(inp.description ?? inp.toolSummary);
      return (description ? { command, description } : { command }) as ToolArgsByKind[K];
    }
    case 'read':
    case 'delete':
      return {
        path: str(
          inp.AbsolutePath ??
            inp.TargetFile ??
            inp.FilePath ??
            inp.path ??
            inp.file_path ??
            inp.Path
        ),
      } as ToolArgsByKind[K];
    case 'write':
      return {
        path: str(
          inp.TargetFile ??
            inp.AbsolutePath ??
            inp.FilePath ??
            inp.path ??
            inp.file_path ??
            inp.Path
        ),
        content: str(inp.CodeContent ?? inp.Content ?? inp.content ?? inp.newContent),
      } as ToolArgsByKind[K];
    case 'edit': {
      const path = str(
        inp.TargetFile ?? inp.AbsolutePath ?? inp.FilePath ?? inp.path ?? inp.file_path ?? inp.Path
      );
      const { old_string, new_string } = antigravityEditOldNewStrings(inp);
      return { path, old_string, new_string } as ToolArgsByKind[K];
    }
    case 'glob':
      return {
        pattern: str(
          inp.Pattern ?? inp.pattern ?? inp.SearchDirectory ?? inp.DirectoryPath ?? inp.path
        ),
        path: strOrNull(inp.SearchDirectory ?? inp.DirectoryPath ?? inp.path),
      } as ToolArgsByKind[K];
    case 'grep':
      return {
        pattern: str(inp.Query ?? inp.Pattern ?? inp.pattern ?? inp.query),
        path: strOrNull(inp.SearchPath ?? inp.SearchDirectory ?? inp.path),
      } as ToolArgsByKind[K];
    case 'ask_user':
      return {
        questions: Array.isArray(inp.questions) ? inp.questions : [],
      } as ToolArgsByKind[K];
    case 'mcp': {
      const short = baguetteMcpShortName(canonical) || canonical.replace(/^mcp_/, '');
      const { tool, toolSummary: _toolSummary, ...rest } = inp;
      return { tool: str(tool ?? short), ...rest } as ToolArgsByKind[K];
    }
    default:
      return mapCursorToolArgs(kind, canonical, inp);
  }
}

/**
 * Strip `agy run_command` envelope metadata (`Created At: ... Command output:\n`)
 * and normalize `\r\n` to `\n`.
 */
function stripAntigravityCommandHeader(rawOutputText: string): {
  stdout: string;
  parsedExitCode: number | null;
} {
  const normalized = rawOutputText.replace(/\r\n/g, '\n');
  let parsedExitCode: number | null = null;
  const exitMatch = normalized.match(/Command exited with code (\d+)\./);
  if (exitMatch) {
    const code = Number(exitMatch[1]);
    if (!Number.isNaN(code)) parsedExitCode = code;
  }
  const marker = '\n\nCommand output:\n';
  const markerIdx = normalized.indexOf(marker);
  if (markerIdx !== -1) {
    return {
      stdout: normalized.slice(markerIdx + marker.length),
      parsedExitCode,
    };
  }
  return { stdout: normalized, parsedExitCode };
}

export function mapAntigravityBashToolResult(
  rawResult: unknown,
  opts: { isError?: boolean } = {}
): ToolResultByKind['bash'] {
  if (isDict(rawResult) && typeof rawResult.output === 'string') {
    const { stdout, parsedExitCode } = stripAntigravityCommandHeader(rawResult.output);
    const rawExit = rawResult.exit_code ?? rawResult.exitCode ?? parsedExitCode;
    let exitCode = rawExit != null ? Number(rawExit) : 0;
    if (Number.isNaN(exitCode)) exitCode = opts.isError ? 1 : 0;
    if (opts.isError && exitCode === 0) exitCode = 1;
    const failed = Boolean(opts.isError) || exitCode !== 0;
    return {
      status: failed ? 'error' : 'ok',
      error_message: failed ? stdout || 'Tool call failed' : null,
      exit_code: exitCode,
      stdout,
      stderr: str(rawResult.stderr ?? ''),
    };
  }
  if (typeof rawResult === 'string' && rawResult.includes('Command output:')) {
    const { stdout, parsedExitCode } = stripAntigravityCommandHeader(rawResult);
    let exitCode = parsedExitCode ?? (opts.isError ? 1 : 0);
    if (opts.isError && exitCode === 0) exitCode = 1;
    const failed = Boolean(opts.isError) || exitCode !== 0;
    return {
      status: failed ? 'error' : 'ok',
      error_message: failed ? stdout || 'Tool call failed' : null,
      exit_code: exitCode,
      stdout,
      stderr: '',
    };
  }
  return mapCursorBashToolResult(rawResult, opts);
}

function mapAntigravityToolResult(
  kind: ToolCallKind,
  rawResult: unknown,
  opts: { isError?: boolean } = {}
): AnyToolResult {
  if (kind === 'bash') {
    return mapAntigravityBashToolResult(rawResult, opts);
  }
  return mapCursorToolResult(kind, rawResult, opts);
}

function textFromToolCallContent(content: ToolCallContent[] | null | undefined): string {
  if (!Array.isArray(content) || content.length === 0) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'content' && item.content?.type === 'text' && item.content.text) {
      parts.push(item.content.text);
      continue;
    }
    const maybeDirectText = (item as { text?: unknown }).text;
    if (typeof maybeDirectText === 'string' && maybeDirectText) {
      parts.push(maybeDirectText);
    }
  }
  return parts.join('\n');
}

function extractRawOutputFromUpdate(update: {
  rawOutput?: unknown;
  content?: ToolCallContent[] | null;
}): unknown {
  if (update.rawOutput !== undefined && update.rawOutput !== null) {
    return update.rawOutput;
  }
  const text = textFromToolCallContent(update.content);
  return text || undefined;
}

export type TrackedToolMeta = {
  name?: string;
  input?: Dict;
};

/** Map one ACP `SessionUpdate` notification to zero or more `MessageOp` values. */
export function mapAntigravityUpdate(
  update: SessionUpdate,
  trackedMeta?: TrackedToolMeta
): MessageOp[] | null {
  if (!update || typeof update !== 'object') return null;

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      if (update.content?.type === 'text' && update.content.text) {
        return [{ op: 'assistant_text', text: update.content.text }];
      }
      return null;
    }

    case 'agent_thought_chunk': {
      if (update.content?.type === 'text' && update.content.text) {
        return [{ op: 'assistant_thinking', text: update.content.text }];
      }
      return null;
    }

    case 'tool_call': {
      const rawName = resolveRawToolName({
        name: update.name,
        title: update.title,
        kind: update.kind,
      });
      const canonical = canonicalizeAntigravityToolName(rawName);
      const rawArgs = (update as { args?: unknown }).args;
      const input = asInput(update.rawInput ?? rawArgs);
      const status = update.status ?? 'in_progress';

      if (PLAN_TOOL_NAMES.has(rawName) || PLAN_TOOL_NAMES.has(canonical)) {
        if (status !== 'completed') return null;
        const markdown = planMarkdownFromToolInput(input);
        return markdown ? [{ op: 'plan', markdown }] : null;
      }

      const ops: MessageOp[] = [
        { op: 'tool_start', call_id: update.toolCallId, name: canonical, input },
      ];
      if (TERMINAL_TOOL_STATUSES.has(status)) {
        const isError = status === 'failed';
        ops.push({
          op: 'tool_result',
          call_id: update.toolCallId,
          name: canonical,
          input,
          raw: extractRawOutputFromUpdate(update),
          is_error: isError,
          status: isError ? 'error' : 'completed',
        });
      }
      return ops;
    }

    case 'tool_call_update': {
      const rawName =
        typeof update.name === 'string' && update.name.trim()
          ? update.name.trim()
          : (trackedMeta?.name ?? '');
      const canonical = rawName ? canonicalizeAntigravityToolName(rawName) : undefined;
      const rawArgs = (update as { args?: unknown }).args;
      const updateInput = asInput(update.rawInput ?? rawArgs);
      const mergedInput =
        trackedMeta?.input && Object.keys(updateInput).length === 0
          ? trackedMeta.input
          : updateInput;
      const status = update.status ?? undefined;

      const effectiveName = canonical ?? '';
      if (effectiveName && (PLAN_TOOL_NAMES.has(rawName) || PLAN_TOOL_NAMES.has(effectiveName))) {
        if (status !== 'completed') return null;
        const markdown = planMarkdownFromToolInput(mergedInput);
        return markdown ? [{ op: 'plan', markdown }] : null;
      }

      if (status && TERMINAL_TOOL_STATUSES.has(status)) {
        const isError = status === 'failed';
        return [
          {
            op: 'tool_result',
            call_id: update.toolCallId,
            ...(canonical ? { name: canonical } : {}),
            ...(Object.keys(updateInput).length > 0 ? { input: updateInput } : {}),
            raw: extractRawOutputFromUpdate(update),
            is_error: isError,
            status: isError ? 'error' : 'completed',
          },
        ];
      }

      if (canonical || Object.keys(updateInput).length > 0) {
        return [
          {
            op: 'tool_start',
            call_id: update.toolCallId,
            name: canonical ?? 'generic',
            input: updateInput,
          },
        ];
      }

      return null;
    }

    default:
      return null;
  }
}

export function antigravityBuildToolCallStart(
  callId: string,
  name: string,
  args: Dict = {},
  startedAt: string = new Date().toISOString()
): ToolCallPayload {
  const canonical = canonicalizeAntigravityToolName(name);
  const kind = antigravityToolKindFromName(canonical);
  return {
    type: 'tool_call',
    id: callId,
    kind,
    name: canonical,
    status: 'running',
    started_at: startedAt,
    ended_at: null,
    result: null,
    args: mapAntigravityToolArgs(kind, canonical, args),
  } as ToolCallPayload;
}

export function antigravityBuildToolCallComplete(
  prev: ToolCallPayload,
  opts: {
    name?: string;
    args?: Dict;
    rawResult?: unknown;
    isError?: boolean;
    toolCallStatus?: string;
    endedAt?: string;
  } = {}
): ToolCallPayload {
  const finalName = canonicalizeAntigravityToolName(opts.name ?? prev.name);
  const kind = antigravityToolKindFromName(finalName);
  let status: ToolCallPayload['status'] = 'completed';
  if (opts.isError || opts.toolCallStatus === 'error' || opts.toolCallStatus === 'failed') {
    status = 'error';
  } else if (opts.toolCallStatus === 'cancelled') {
    status = 'cancelled';
  }

  return {
    ...prev,
    type: 'tool_call',
    id: prev.id,
    kind,
    name: finalName,
    status,
    ended_at: opts.endedAt ?? new Date().toISOString(),
    args: mapAntigravityToolArgs(kind, finalName, opts.args ?? (prev.args as Dict)),
    result: mapAntigravityToolResult(kind, opts.rawResult, {
      isError: status === 'error',
    }),
  } as ToolCallPayload;
}

export function antigravityTurnResultOps(
  status: 'ok' | 'error',
  error_message: string | null,
  total_cost_usd: number | null = 0
): MessageOp[] {
  return [
    {
      op: 'turn_result',
      payload: {
        type: 'turn_result',
        status,
        error_message: status === 'ok' ? null : error_message,
        total_cost_usd,
      },
    },
  ];
}
