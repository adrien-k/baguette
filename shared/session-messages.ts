/**
 * Canonical shapes stored in session_messages.message_json for both builder and
 * reviewer rows (differentiated by the `agent_type` column).
 */

export type ToolCallStatus = 'running' | 'completed' | 'error';

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
  source?: 'baguette';
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
  subtype: 'status' | 'prompt';
  status?: string;
  content?: string;
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
