/**
 * Minimal structural types shared by the Claude and Cursor agent services.
 * The Feathers app, its services, and the SQLite handle stay loosely typed; the
 * message payloads, rows, and turn state are typed precisely against
 * `shared/session-messages.ts`.
 */

import type { SessionMessageRow } from '../../../shared/session-messages.ts';

export type MessageChannel = 'chat' | 'review';

/** Minimal Feathers application surface used by the agent services. */
export type AgentApp = {
  get(key: string): unknown;
  // Service implementations vary; call sites validate their own payloads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service(path: string): any;
  use(path: string, service: unknown, opts?: { methods?: string[] }): void;
  emit(event: string, data: unknown): void;
  services?: Record<string, unknown>;
};

type QueryBuilderMethods = {
  where(conds: Record<string, unknown>): QueryBuilderLike;
  whereIn(column: string, values: readonly unknown[]): QueryBuilderLike;
  orderBy(column: string, direction?: 'asc' | 'desc'): QueryBuilderLike;
  select(...columns: string[]): QueryBuilderLike;
  first(): Promise<Record<string, unknown> | undefined>;
  insert(row: Record<string, unknown>): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
  distinct(column: string): Promise<Array<Record<string, unknown>>>;
};

export type QueryBuilderLike = QueryBuilderMethods & Promise<Array<Record<string, unknown>>>;

/** Minimal knex/better-sqlite3 handle used by the agent services. */
export type DbLike = {
  (table: string): QueryBuilderLike;
};

/** `agents` table row used by SDK services. */
export type AgentRow = {
  id: number;
  session_id: number;
  name: string;
  agent_type: string;
  is_primary: number;
  status: string;
  agent_config_id?: number | null;
  agent_sdk?: string | null;
  model?: string | null;
  model_params?: unknown;
  claude_session_id?: string | null;
  cursor_agent_id?: string | null;
  pi_session_id?: string | null;
  current_turn_id?: number;
  active_turn_id?: number | null;
  initial_prompt?: string | null;
  [key: string]: unknown;
};

/** Sessions row subset the agent services read (lifecycle + repo context). */
export type AgentSessionRow = {
  id: number;
  user_id: number;
  status?: string | null;
  archived_at?: string | null;
  repo_id?: number | null;
  repo_full_name?: string | null;
  base_branch?: string | null;
  session_path?: string | null;
  absolute_session_path?: string | null;
  plugins?: string | null;
  plan_mode?: boolean | null;
  remote_branch?: string | null;
  agent_preferences?: string | null;
  [key: string]: unknown;
};

/** Message row as dispatched to the agent services. */
export type MessageRowLike = SessionMessageRow & {
  /** Cursor steering flag (queued flushes mark rows forced into the active turn). */
  force?: boolean;
};

export type TiedSessionLoopCompactionArgs = {
  sessionId: number;
  promptMessageJson: string;
  identity: Record<string, unknown>;
  userParams: { user: { id: number } };
};

/** Agent service hook: start a tied-session loop iteration (compact or re-prompt). */
export interface AgentLoopCompactionService {
  prepareTiedSessionLoopCompaction(args: TiedSessionLoopCompactionArgs): Promise<void>;
}
