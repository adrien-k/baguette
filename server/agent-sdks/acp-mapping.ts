/**
 * Unified ACP `SessionUpdate` → canonical Baguette `MessageOp` values & tool payloads.
 *
 * Self-contained: does not import from any SDK-specific folder.
 */

import type { SessionUpdate, ToolCallContent, ToolKind } from '@agentclientprotocol/sdk/unstable';
import { planMarkdownFromToolInput } from '../../shared/plan-markdown.ts';
import type {
  AnyToolResult,
  MessageOp,
  ToolArgsByKind,
  ToolCallKind,
  ToolCallPayload,
  ToolResultByKind,
} from '../../shared/message-types.ts';
import {
  baguetteMcpShortName,
  isBaguetteMcpToolName,
} from '../../shared/baguette-mcp-tool-names.js';
import type { ToolCallBuilders } from '../../shared/message-stream-writer.ts';

export type Dict = Record<string, unknown>;

export type ToolListItem = {
  name: string;
  description: string;
  schema: unknown;
  handler: (args: Dict) => Promise<unknown>;
};

const ACP_TOOL_ALIAS: Record<string, string> = {
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

const ACP_KIND_TO_TOOL_CALL_KIND: Partial<Record<ToolKind, ToolCallKind>> = {
  execute: 'bash',
  read: 'read',
  edit: 'edit',
  delete: 'delete',
  search: 'grep',
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
 * Translate an ACP tool name into Baguette's canonical vocabulary
 * (`Bash`, `Read`, `mcp__baguette__<Short>`, …).
 */
export function canonicalizeAcpToolName(name: string): string {
  if (!name) return name;
  if (name.startsWith('mcp__')) return name;
  if (name.startsWith('mcp_baguette_')) {
    return `mcp__baguette__${name.slice('mcp_baguette_'.length)}`;
  }
  return ACP_TOOL_ALIAS[name] ?? name;
}

function mcpWrappedToolName(canonicalName: string, args?: unknown): string {
  if (canonicalName !== 'mcp' || !isDict(args)) return '';
  if (typeof args.tool === 'string' && args.tool) return args.tool;
  if (typeof args.toolName === 'string' && args.toolName) return args.toolName;
  if (isDict(args.args) && typeof args.args.tool === 'string' && args.args.tool) {
    return args.args.tool;
  }
  if (isDict(args.args) && typeof args.args.toolName === 'string' && args.args.toolName) {
    return args.args.toolName;
  }
  return '';
}

function unwrapMetaToolInput(canonicalName: string, inp: Dict): Dict {
  if (canonicalName !== 'mcp') return inp;
  if (!mcpWrappedToolName(canonicalName, inp)) return inp;
  const nested = isDict(inp.args) ? inp.args : {};
  const { tool: _tool, toolName: _toolName, args: _args, ...rest } = inp;
  const { tool: _nestedTool, toolName: _nestedToolName, ...fields } = nested;
  return { ...fields, ...rest };
}

export function acpToolKindFromName(
  canonicalName: string,
  acpKind?: ToolKind | null,
  args?: unknown
): ToolCallKind {
  if (canonicalName === 'AskUserQuestion' || canonicalName === 'AskUserQuestions') {
    return 'ask_user';
  }
  const short = baguetteMcpShortName(canonicalName);
  if (short === 'AskUserQuestions') return 'ask_user';
  const wrapped = mcpWrappedToolName(canonicalName, args);
  if (wrapped === 'AskUserQuestion' || wrapped === 'AskUserQuestions') {
    return 'ask_user';
  }
  if (
    canonicalName === 'mcp' ||
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
  if (map[canonicalName]) return map[canonicalName];
  if (acpKind && ACP_KIND_TO_TOOL_CALL_KIND[acpKind]) {
    return ACP_KIND_TO_TOOL_CALL_KIND[acpKind]!;
  }
  return 'generic';
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

function editOldNewStrings(inp: Dict): {
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
    old_string: strOrNull(
      inp.TargetContent ?? inp.Target ?? inp.oldString ?? inp.old_string ?? inp.oldText
    ),
    new_string: strOrNull(
      inp.ReplacementContent ?? inp.Replacement ?? inp.newString ?? inp.new_string ?? inp.newText
    ),
  };
}

export function mapAcpToolArgs<K extends ToolCallKind>(
  kind: K,
  toolName: string,
  input: Dict = {}
): ToolArgsByKind[K] {
  const canonical = canonicalizeAcpToolName(toolName);
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
      const { old_string, new_string } = editOldNewStrings(inp);
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
    case 'todo': {
      if (Array.isArray(inp.todos)) {
        return { todos: inp.todos } as ToolArgsByKind[K];
      }
      return {
        todos: [
          {
            content: str(inp.subject ?? inp.content ?? inp.description ?? '', ''),
            status: str(inp.status ?? 'pending'),
            activeForm: str(inp.activeForm ?? inp.active_form ?? ''),
          },
        ],
      } as ToolArgsByKind[K];
    }
    case 'task':
      return {
        description: str(inp.description),
        subagent_type: str(inp.subagent_type ?? inp.subagentType ?? 'subagent'),
      } as ToolArgsByKind[K];
    case 'ask_user': {
      const unwrapped = unwrapMetaToolInput(canonical, inp);
      return {
        questions: Array.isArray(unwrapped.questions) ? unwrapped.questions : [],
      } as ToolArgsByKind[K];
    }
    case 'exit_plan':
      return { plan: str(inp.plan ?? inp.planContent) } as ToolArgsByKind[K];
    case 'mcp': {
      if (canonical === 'mcp') {
        const nested = isDict(inp.args) ? inp.args : {};
        const {
          toolName: toolNameField,
          tool: topTool,
          args: _args,
          toolSummary: _ts,
          ...rest
        } = inp;
        const { tool: nestedTool, toolName: nestedToolName, toolSummary: _nts, ...fields } = nested;
        const resolved =
          strOrNull(toolNameField ?? topTool ?? nestedTool ?? nestedToolName) ?? 'mcp';
        return {
          tool: resolved,
          ...fields,
          ...rest,
        } as ToolArgsByKind[K];
      }
      const short = baguetteMcpShortName(canonical) || canonical.replace(/^mcp_/, '');
      const { tool, toolSummary: _toolSummary, ...rest } = inp;
      return { tool: str(tool ?? short), ...rest } as ToolArgsByKind[K];
    }
    default:
      return {
        label: canonical,
        detail: strOrNull(inp.description ?? inp.command),
        input: inp,
      } as ToolArgsByKind[K];
  }
}

/**
 * Strip `agy run_command` envelope metadata (`Created At: ... Command output:\n`)
 * and normalize `\r\n` to `\n`.
 */
function stripCommandEnvelopeHeader(rawOutputText: string): {
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

export function mapAcpBashToolResult(
  rawResult: unknown,
  opts: { isError?: boolean } = {}
): ToolResultByKind['bash'] {
  if (
    isDict(rawResult) &&
    isDict(rawResult.structuredContent) &&
    rawResult.structuredContent.output != null
  ) {
    const structured = rawResult.structuredContent;
    const exitRaw = structured.exit_code ?? structured.exitCode;
    let exitCode = exitRaw != null ? Number(exitRaw) : 0;
    if (Number.isNaN(exitCode)) exitCode = opts.isError ? 1 : 0;
    if (opts.isError && exitCode === 0) exitCode = 1;
    const stdout = str(structured.output);
    const failed = Boolean(opts.isError) || exitCode !== 0;
    return {
      status: failed ? 'error' : 'ok',
      error_message: failed ? stdout || 'Tool call failed' : null,
      exit_code: exitCode,
      stdout,
      stderr: '',
    };
  }
  if (isDict(rawResult) && Array.isArray(rawResult.content) && rawResult.output === undefined) {
    const text = rawResult.content
      .map((b) => (isDict(b) && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
    if (text) {
      let stdout = text;
      let exitCode = 0;
      const exitSuffix = stdout.match(/\n\nCommand exited with code (\d+)\s*$/);
      if (exitSuffix && exitSuffix.index != null) {
        exitCode = Number(exitSuffix[1]);
        stdout = stdout.slice(0, exitSuffix.index);
      }
      if (opts.isError && exitCode === 0) exitCode = 1;
      const failed = Boolean(opts.isError) || exitCode !== 0;
      return {
        status: failed ? 'error' : 'ok',
        error_message: failed ? stdout || 'Tool call failed' : null,
        exit_code: Number.isNaN(exitCode) ? 1 : exitCode,
        stdout,
        stderr: '',
      };
    }
  }
  if (isDict(rawResult) && typeof rawResult.output === 'string') {
    const { stdout, parsedExitCode } = stripCommandEnvelopeHeader(rawResult.output);
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
    const { stdout, parsedExitCode } = stripCommandEnvelopeHeader(rawResult);
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

  const isError = Boolean(opts.isError);
  let exitCode = isError ? 1 : 0;
  let stdout = '';
  let stderr = '';

  if (rawResult === undefined || rawResult === null) {
    return {
      status: isError ? 'error' : 'ok',
      error_message: isError ? 'Tool call failed' : null,
      exit_code: exitCode,
      stdout,
      stderr,
    };
  }

  let parsed: unknown = rawResult;
  if (typeof rawResult === 'string') {
    if (!rawResult.trim()) {
      return {
        status: isError ? 'error' : 'ok',
        error_message: isError ? 'Tool call failed' : null,
        exit_code: exitCode,
        stdout,
        stderr,
      };
    }
    try {
      parsed = JSON.parse(rawResult);
    } catch {
      return {
        status: isError ? 'error' : 'ok',
        error_message: isError ? rawResult : null,
        exit_code: exitCode,
        stdout: rawResult,
        stderr: '',
      };
    }
  }

  if (!isDict(parsed)) {
    const text = String(parsed);
    return {
      status: isError ? 'error' : 'ok',
      error_message: isError ? text : null,
      exit_code: exitCode,
      stdout: text,
      stderr: '',
    };
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
  if (isError && exitCode === 0) exitCode = 1;
  const failed = isError || exitCode !== 0;

  return {
    status: failed ? 'error' : 'ok',
    error_message: failed ? stderr || stdout || 'Tool call failed' : null,
    exit_code: Number.isNaN(exitCode) ? 1 : exitCode,
    stdout,
    stderr,
  };
}

function resultToText(raw: unknown, isError: boolean): { content: string; isError: boolean } {
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

export function mapAcpToolResult(
  kind: ToolCallKind,
  rawResult: unknown,
  opts: { isError?: boolean } = {}
): AnyToolResult {
  const isError = Boolean(opts.isError);

  if (kind === 'bash') {
    return mapAcpBashToolResult(rawResult, { isError });
  }

  if (kind === 'edit') {
    let diff: string | null = null;
    if (isDict(rawResult)) {
      const v = isDict(rawResult.value) ? rawResult.value : rawResult;
      const details = isDict(rawResult.details) ? rawResult.details : null;
      diff = strOrNull(
        (v as Dict).diffString ?? (v as { diff?: unknown }).diff ?? details?.diff ?? details?.patch
      );
    }
    const { content, isError: contentIsError } = resultToText(rawResult, isError);
    return {
      status: contentIsError ? 'error' : 'ok',
      error_message: contentIsError ? content || 'Tool call failed' : null,
      diff,
    } as AnyToolResult;
  }

  if (kind === 'task') {
    const { content, isError: contentIsError } = resultToText(rawResult, isError);
    return {
      status: contentIsError ? 'error' : 'ok',
      error_message: contentIsError ? content || 'Tool call failed' : null,
      summary: content || null,
      steps: [],
      step_count: 0,
    } as AnyToolResult;
  }

  if (kind === 'mcp') {
    const { content, isError: contentIsError } = resultToText(rawResult, isError);
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
    const { content, isError: contentIsError } = resultToText(rawResult, isError);
    return {
      status: contentIsError ? 'error' : 'ok',
      error_message: contentIsError ? content || 'Tool call failed' : null,
      content,
    } as AnyToolResult;
  }

  const { content, isError: contentIsError } = resultToText(rawResult, isError);
  return {
    status: contentIsError ? 'error' : 'ok',
    error_message: contentIsError ? content || 'Tool call failed' : null,
  } as AnyToolResult;
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
export function mapAcpUpdate(
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

    case 'plan': {
      const entries = (update as { entries?: Array<{ content?: unknown; status?: unknown }> })
        .entries;
      if (!Array.isArray(entries) || entries.length === 0) return null;
      const todos = entries.map((e) => ({
        content: str(e?.content),
        status: str(e?.status ?? 'pending'),
      }));
      const callId = 'acp-plan';
      return [
        { op: 'tool_start', call_id: callId, name: 'TodoWrite', input: { todos } },
        {
          op: 'tool_result',
          call_id: callId,
          name: 'TodoWrite',
          input: { todos },
          raw: { todos },
          is_error: false,
          status: 'completed',
        },
      ];
    }

    case 'tool_call': {
      const rawName = resolveRawToolName({
        name: update.name,
        title: update.title,
        kind: update.kind,
      });
      const canonical = canonicalizeAcpToolName(rawName);
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
      const canonical = rawName ? canonicalizeAcpToolName(rawName) : undefined;
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

    case 'usage_update':
    default:
      return null;
  }
}

export function acpBuildToolCallStart(
  callId: string,
  name: string,
  args: Dict = {},
  startedAt: string = new Date().toISOString()
): ToolCallPayload {
  const canonical = canonicalizeAcpToolName(name);
  const kind = acpToolKindFromName(canonical, undefined, args);
  return {
    type: 'tool_call',
    id: callId,
    kind,
    name: canonical,
    status: 'running',
    started_at: startedAt,
    ended_at: null,
    result: null,
    args: mapAcpToolArgs(kind, canonical, args),
  } as ToolCallPayload;
}

export function acpBuildToolCallComplete(
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
  const finalName = canonicalizeAcpToolName(opts.name ?? prev.name);
  const effectiveArgs = opts.args ?? (prev.args as Dict);
  const kind = acpToolKindFromName(finalName, undefined, effectiveArgs);
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
    args: mapAcpToolArgs(kind, finalName, opts.args ?? (prev.args as Dict)),
    result: mapAcpToolResult(kind, opts.rawResult, {
      isError: status === 'error',
    }),
  } as ToolCallPayload;
}

export function acpToolCallBuilders(): ToolCallBuilders {
  return {
    buildToolCallStart: acpBuildToolCallStart,
    buildToolCallComplete: acpBuildToolCallComplete,
  };
}

export function acpTurnResultOps(
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
