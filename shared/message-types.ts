/**
 * Canonical Baguette message types.
 *
 * This module is the single source of truth for every message that Baguette
 * stores, transports, or renders. It is deliberately provider-agnostic: no
 * Claude or Cursor SDK shape appears here. Conversion in that direction lives
 * in `server/services/claude/claude-mapping.ts` and `server/services/cursor/cursor-mapping.ts`,
 * which map a provider event to one or more `MessageOp` values — the only
 * vocabulary the persistence layer understands.
 *
 * Resumption is deliberately *not* modelled. Both SDKs resume from an opaque
 * id (`sessions.claude_session_id`, `Agent.resume(cursor_agent_id)`), so
 * canonical rows are never replayed back into a provider history. Mapping is
 * inbound only.
 */

// ─── Tool kinds ──────────────────────────────────────────────────────────────

/**
 * The complete set of tools Baguette understands.
 *
 * Every tool call — from any provider — resolves to exactly one of these.
 * `generic` is the documented escape hatch for a tool we did not anticipate:
 * it keeps the raw provider name in `name` so nothing is lost, and still
 * renders. `mcp` covers every `mcp__*` tool, Baguette's own included.
 */
export type ToolCallKind =
  | 'bash'
  | 'read'
  | 'delete'
  | 'glob'
  | 'grep'
  | 'write'
  | 'edit'
  | 'todo'
  | 'task'
  | 'ask_user'
  | 'exit_plan'
  | 'mcp'
  | 'generic';

export const TOOL_CALL_KINDS = [
  'bash',
  'read',
  'delete',
  'glob',
  'grep',
  'write',
  'edit',
  'todo',
  'task',
  'ask_user',
  'exit_plan',
  'mcp',
  'generic',
] as const satisfies readonly ToolCallKind[];

export type ToolCallStatus = 'running' | 'completed' | 'error' | 'cancelled';

/** Fields shared by every tool result, regardless of kind. */
export type ToolResultBase = {
  status: 'ok' | 'error';
  error_message: string | null;
};

// ─── Per-kind args and results ───────────────────────────────────────────────

export type TodoItem = {
  content?: string;
  status?: string;
  activeForm?: string;
  [key: string]: unknown;
};

export type AskUserOption = {
  label?: string;
  description?: string;
  [key: string]: unknown;
};

export type AskUserQuestion = {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: AskUserOption[];
  [key: string]: unknown;
};

/**
 * Typed `args` per kind. `mcp` and `generic` stay open on purpose: their
 * argument shape is defined by the called tool, not by us.
 */
export type ToolArgsByKind = {
  bash: { command: string };
  read: { path: string };
  delete: { path: string };
  write: { path: string; content: string };
  edit: { path: string; old_string: string | null; new_string: string | null };
  glob: { pattern: string; path: string | null };
  grep: { pattern: string; path: string | null };
  todo: { todos: TodoItem[] };
  task: { description: string; subagent_type: string | null };
  ask_user: { questions: AskUserQuestion[] };
  exit_plan: { plan: string };
  mcp: { tool: string } & Record<string, unknown>;
  generic: { label: string; detail: string | null; input: Record<string, unknown> };
};

/** Typed `result` per kind. Every variant carries status + error_message. */
export type ToolResultByKind = {
  bash: ToolResultBase & { exit_code: number; stdout: string; stderr: string };
  read: ToolResultBase;
  delete: ToolResultBase;
  write: ToolResultBase;
  glob: ToolResultBase;
  grep: ToolResultBase;
  edit: ToolResultBase & { diff: string | null };
  todo: ToolResultBase;
  task: ToolResultBase & { summary: string | null };
  ask_user: ToolResultBase;
  exit_plan: ToolResultBase;
  mcp: ToolResultBase & {
    content?: string | null;
    /** Parsed MCP result payload (issue, uploaded image URL, task log, …), when JSON. */
    data?: Record<string, unknown> | null;
  };
  generic: ToolResultBase & { content?: string | null };
};

/** Untyped result alias kept for client code that handles several kinds at once. */
export type GenericToolResult = ToolResultBase;

// ─── Tool call payload (discriminated union) ─────────────────────────────────

type ToolCallCommon = {
  type: 'tool_call';
  /** Provider-scoped call id. Unique per (session_id, tool_call_id) in the DB. */
  id: string;
  /** Canonical tool name, e.g. 'Bash', 'mcp__baguette__create_issue'. */
  name: string;
  status: ToolCallStatus;
  started_at: string;
  ended_at: string | null;
};

/**
 * A tool call, discriminated by `kind`.
 *
 * Narrowing on `kind` narrows `args` and `result` in the same branch:
 * `if (call.kind === 'bash') call.result.exit_code` type-checks.
 */
export type ToolCallPayload<K extends ToolCallKind = ToolCallKind> = ToolCallCommon &
  { [P in K]: { kind: P; args: ToolArgsByKind[P]; result: ToolResultByKind[P] | null } }[K];

/** Open result alias for code that handles any tool result. */

export type AnyToolResult = ToolResultByKind[ToolCallKind];

// ─── Message payloads ────────────────────────────────────────────────────────

export type UserMessagePayload = {
  type: 'user';
  content: string;
  /** `baguette` = typed in the UI; `mcp` = injected by an MCP tool; absent = provider echo. */
  source?: 'baguette' | 'mcp';
  title?: string;
  /** `null` is allowed to mirror the nullable `session_messages.subtype` column. */
  subtype?: string | null;
};

export type AssistantBlock =
  { type: 'text'; text: string } | { type: 'thinking'; thinking: string };

export type AssistantMessagePayload = {
  type: 'assistant';
  blocks: AssistantBlock[];
};

/**
 * Non-conversational rows: status lines, init markers, thinking-token
 * counters, task notifications. `subtype` selects the renderer.
 */
export type SystemMessagePayload = {
  type: 'system';
  subtype: string;
  status?: string;
  content?: string;
  text?: string;
  task_status?: string;
  estimated_tokens?: number | null;
  estimated_tokens_delta?: number | null;
  tool_use_id?: string;
  summary?: string;
  description?: string;
};

/** Terminal verdict for one agent turn. Exactly one per turn. */
export type TurnResultPayload = {
  type: 'turn_result';
  status: 'ok' | 'error';
  error_message: string | null;
  total_cost_usd: number | null;
};

/** Plan presented for review while `sessions.plan_mode` is on. Never a tool_call row. */
export type PlanMessagePayload = {
  type: 'plan';
  markdown: string;
};

/** Everything that can live in `session_messages.message_json`. */
export type SessionMessagePayload =
  | UserMessagePayload
  | AssistantMessagePayload
  | ToolCallPayload
  | SystemMessagePayload
  | TurnResultPayload
  | PlanMessagePayload;

/** Narrow a payload union by its `type` discriminant. */
export type PayloadOfType<T extends SessionMessagePayload['type']> = Extract<
  SessionMessagePayload,
  { type: T }
>;

// ─── Ops: the provider-agnostic write vocabulary ─────────────────────────────

/**
 * A single unit of work produced by a provider mapping module.
 *
 * Mapping modules translate one provider event into zero or more ops; the
 * writer turns ops into DB rows. Keeping this vocabulary tiny is what lets
 * `MessageStreamWriter` stay provider-agnostic.
 */
export type MessageOp =
  | { op: 'assistant_text'; text: string }
  | { op: 'assistant_thinking'; text: string }
  | { op: 'tool_start'; call_id: string; name: string; input: Record<string, unknown> }
  | {
      op: 'tool_result';
      call_id: string;
      name?: string;
      input?: Record<string, unknown>;
      /** Raw, still provider-shaped result; mapped to a typed result by the writer. */
      raw: unknown;
      is_error?: boolean;
      status?: string;
    }
  | { op: 'plan'; markdown: string }
  | { op: 'system'; payload: SystemMessagePayload }
  | { op: 'turn_result'; payload: TurnResultPayload };

export type { SessionMessageRow } from './session-messages.ts';
