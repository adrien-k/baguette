/**
 * Canonical shapes stored in session_messages.message_json for both builder and
 * reviewer rows (differentiated by the `agent_type` column).
 */

export type ToolCallStatus = 'running' | 'completed' | 'error' | 'cancelled';

export type GenericToolResult = {
  status: 'ok' | 'error';
  error_message: string | null;
};

export type BashToolResult = {
  exit_code: number;
  stdout: string;
  stderr: string;
};

export type EditToolResult = GenericToolResult & {
  diff: string | null;
};

export type TaskToolResult = GenericToolResult & {
  summary: string | null;
};

export type McpToolResult = GenericToolResult & {
  content?: string | null;
  /** Parsed MCP result payload (issue, uploaded image URL, task log, …), when JSON. */
  data?: Record<string, unknown> | null;
};

export type ClaudeTaskToolResult = GenericToolResult & {
  summary?: string | null;
};

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
  | 'claude_task'
  | 'generic';

export type ToolCallPayload = {
  type: 'tool_call';
  id: string;
  kind: ToolCallKind;
  name: string;
  status: ToolCallStatus;
  started_at: string;
  ended_at: string | null;
  result:
    | BashToolResult
    | EditToolResult
    | TaskToolResult
    | McpToolResult
    | ClaudeTaskToolResult
    | GenericToolResult
    | null;
  args: Record<string, unknown>;
};

export type UserMessagePayload = {
  type: 'user';
  content: string;
  source?: 'baguette' | 'mcp';
  title?: string;
  subtype?: string;
};

export type AssistantBlock =
  { type: 'text'; text: string } | { type: 'thinking'; thinking: string };

export type AssistantMessagePayload = {
  type: 'assistant';
  blocks: AssistantBlock[];
};

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

export type TurnResultPayload = {
  type: 'turn_result';
  status: 'ok' | 'error';
  error_message: string | null;
  total_cost_usd: number | null;
};

/** Plan presented for user review while session.plan_mode is on (not a tool_call row). */
export type PlanMessagePayload = {
  type: 'plan';
  markdown: string;
};

export type SessionMessagePayload =
  | UserMessagePayload
  | AssistantMessagePayload
  | ToolCallPayload
  | SystemMessagePayload
  | TurnResultPayload
  | PlanMessagePayload;

// ─── DB rows ─────────────────────────────────────────────────────────────────

/** Columns shared by session_messages and session_review_messages. */
export type SessionMessageRow = {
  id: number;
  session_id: number;
  /** Row discriminant; matches the payload discriminant for typed rows. */
  type: string;
  subtype: string | null;
  message_json: string | null;
  turn_id: number | null;
  tool_call_id: string | null;
  tool_status: ToolCallStatus | null;
  tool_started_at: string | null;
  tool_ended_at: string | null;
  created_at: string;
  total_cost_usd: number | null;
  /** Model snapshot for user rows; legacy rows carry extra SDK fields. */
  model?: string | null;
  model_params?: unknown;
  /** Raw SDK columns that survive on legacy rows (uuid, parent_tool_use_id, …). */
  [key: string]: unknown;
};

// ─── Client view models ──────────────────────────────────────────────────────

/** Row meta merged onto every parsed view (typed or legacy). */
export type MessageViewMeta = {
  id: number;
  session_id: number;
  created_at?: string;
  turn_id?: number | null;
  subtype?: string | null;
  model?: string | null;
  model_params?: unknown;
  tool_status?: ToolCallStatus | null;
  tool_started_at?: string | null;
  tool_ended_at?: string | null;
};

/**
 * View for rows whose message_json is a typed payload: the payload fields plus row meta.
 * This is what the typed `ChatMessage` renders — no SDK/legacy shapes.
 */
export type TypedMessageView = SessionMessagePayload & MessageViewMeta;

/** Typed tool_call row view: the payload plus row meta (call_id lands here too). */
export type ToolCallView = ToolCallPayload & MessageViewMeta & { call_id?: string | null };

/** Merged tool-result carrier rows (hidden in chat; removed by backfill). */
export type ToolResultCarrierView = MessageViewMeta & { type: 'tool_result_carrier' };

export type ChatMessageView = TypedMessageView | ToolResultCarrierView;
