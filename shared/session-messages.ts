/**
 * DB row and client view-model shapes.
 *
 * The canonical message payloads (User/Assistant/ToolCall/System/TurnResult/Plan)
 * live in `./message-types.ts` and are re-exported here for the many callers
 * that already import from this module.
 */

export type {
  AssistantBlock,
  AssistantMessagePayload,
  PlanMessagePayload,
  SessionMessagePayload,
  SystemMessagePayload,
  ToolCallKind,
  ToolCallPayload,
  ToolResultByKind,
  TurnResultPayload,
  UserMessagePayload,
  GenericToolResult,
} from './message-types.ts';

import type { SessionMessagePayload, ToolCallPayload, ToolCallStatus } from './message-types.ts';

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
  agent_sdk?: 'claude' | 'cursor' | 'pi' | null;
  agent_config_id?: number | null;
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
  agent_sdk?: 'claude' | 'cursor' | 'pi' | null;
  agent_config_id?: number | null;
};

/** Typed tool_call row view: the payload plus row meta (call_id lands here too). */
export type ToolCallView = ToolCallPayload & MessageViewMeta & { call_id?: string | null };

/**
 * View for rows whose message_json is a typed payload: the payload fields plus row meta.
 * This is what the typed `ChatMessage` renders — no SDK/legacy shapes.
 *
 * `ToolCallView` is listed explicitly because a distributed union does not
 * distribute over an intersection: `SessionMessagePayload & MessageViewMeta`
 * would not carry the `call_id` that `parseMessageRow` sets on tool rows.
 */
export type TypedMessageView =
  (Exclude<SessionMessagePayload, ToolCallPayload> & MessageViewMeta) | ToolCallView;

/** Merged tool-result carrier rows (hidden in chat; removed by backfill). */
export type ToolResultCarrierView = MessageViewMeta & { type: 'tool_result_carrier' };

export type ChatMessageView = TypedMessageView | ToolResultCarrierView;
