/**
 * ACP-shaped `AgentDriver` contract.
 *
 * Every agent runtime (generic ACP subprocesses via `AcpProcessDriver`, or
 * in-process native SDKs like Claude, Cursor, Pi, Mock) implements `AgentDriver`.
 * `GenericAgentService` owns the Feathers lifecycle, active-turn map, stream
 * writer, and status persistence, delegating runtime execution and optional
 * SDK-specific hooks to the driver.
 */

import type {
  McpServer as AcpMcpServer,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  StopReason,
} from '@agentclientprotocol/sdk/unstable';
import type { MessageStreamWriter } from '../../shared/message-stream-writer.ts';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  MessageChannel,
  MessageRowLike,
  TiedSessionLoopCompactionArgs,
} from '../services/feathers/agent-service-types.ts';
import type { TurnModelContext } from '../services/agent-service-lifecycle.ts';
import type { ToolListItem } from './acp-mapping.ts';

export type DriverMcpServersMap = Record<string, Record<string, unknown>>;

export type DriverContext = {
  app: AgentApp;
  sdk: string;
  session: AgentSessionRow;
  agent: AgentRow;
  channel: MessageChannel;
  userId: number;
  turnId: number | null;
  turnModel: TurnModelContext;
  turnAgentConfigId: number | null;
  cwd: string;
  /** Optional MCP server entries from `loadEnabledMcpServersForSession`. */
  userMcpServers?: DriverMcpServersMap;
  /** Generic Baguette MCP tool definitions (`buildBaguetteToolList` / `buildReviewerAgentTools`). */
  baguetteTools: ToolListItem[];
  /** System prompt append string (`buildSystemPromptAppend` or review context). */
  systemPromptAppend?: string | null;
  /** Initial user prompt row (used by drivers that inspect row metadata). */
  row?: MessageRowLike;
  /** Stream writer for the active turn, when `turnId != null`. */
  writer?: MessageStreamWriter | null;
  /** Append a raw event line to the session's `agent-events/` JSONL log. */
  appendRawEvent?: (event: unknown) => Promise<void>;
};

export type DriverNewSessionParams = {
  cwd: string;
  mcpServers?: AcpMcpServer[];
  tools?: ToolListItem[];
  systemPromptAppend?: string | null;
  model?: string | null;
  modelParams?: unknown;
};

export type DriverResumeSessionParams = DriverNewSessionParams & {
  storedSessionId: string;
};

export type DriverSessionResult = {
  /** Driver-assigned session ID passed to `prompt`, `cancel`, `setModel`, `closeSession`. */
  sessionId: string;
  /** Provider-persisted session ID to save in `agents.<storedSessionIdColumn>`, if changed. */
  storedSessionId?: string | null;
  /** Optional model metadata discovered during session creation/resume. */
  availableModels?: Array<{ modelId: string; name?: string; description?: string | null }>;
  currentModelId?: string | null;
};

export type DriverPromptUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  total_tokens?: number;
  cost_usd?: number | null;
  [key: string]: unknown;
};

export type DriverPromptResult = {
  stopReason: StopReason | 'aborted' | 'error';
  usage?: DriverPromptUsage | null;
  /** Set when a permission/question tool ended the turn awaiting user input. */
  awaitingUser?: boolean;
  /** Optional error message when `stopReason === 'error'`. */
  errorMessage?: string | null;
  /** Extra metadata forwarded to `reviewAgentTurn.onAgentTurnComplete`. */
  reviewExtra?: Record<string, unknown>;
};

export type DriverPermissionRequest = {
  sessionId: string;
  toolCall: RequestPermissionRequest['toolCall'];
  options: PermissionOption[];
  /** Optional SDK-specific payload (e.g. `AskUserQuestion` input). */
  raw?: unknown;
};

export type DriverPermissionHandler = (
  req: DriverPermissionRequest
) => Promise<RequestPermissionResponse>;

export type DriverUsageGuard = {
  /** Called periodically or on usage updates; return non-null to abort turn for limit. */
  check?: (usage: DriverPromptUsage) => Promise<{ hit: boolean; message?: string } | null>;
  dispose?: () => void;
};

export type DriverRecordUsageOpts = {
  usage: DriverPromptUsage;
  turnModel: TurnModelContext;
  patchSessionCost: boolean;
  agentConfigId: number | null;
  agentId: number;
  session: AgentSessionRow;
  channel: MessageChannel;
  turnId: number | null;
};

export type DriverCompleteTextParams = {
  app: AgentApp;
  userId: number;
  agentConfigId?: number | null;
  cwd: string;
  prompt: string;
  model?: string | null;
  signal: AbortSignal;
};

export interface AgentDriver {
  /** Initialize the runtime for a turn (spawn subprocess or bind SDK client). */
  start(ctx: DriverContext): Promise<void>;

  /** Create a fresh runtime session. */
  newSession(params: DriverNewSessionParams): Promise<DriverSessionResult>;

  /** Resume an existing runtime session from a stored DB session ID. */
  resume(storedSessionId: string, params: DriverNewSessionParams): Promise<DriverSessionResult>;

  /** Change the active model on a running session. */
  setModel?(sessionId: string, modelId: string, modelParams?: unknown): Promise<void>;

  /** Change an ACP-style config option (e.g. thought level) on a running session. */
  setConfigOption?(sessionId: string, configId: string, value: string): Promise<void>;

  /**
   * Execute one turn with the given prompt text. Resolves when the turn finishes,
   * is cancelled, or hits a fatal error.
   */
  prompt(
    sessionId: string,
    content: string,
    opts?: { signal?: AbortSignal; payload?: unknown }
  ): Promise<DriverPromptResult>;

  /** Subscribe to ACP `SessionNotification` updates emitted during `prompt`. */
  onUpdate(listener: (notification: SessionNotification) => void): () => void;

  /** Cancel an in-flight `prompt` for `sessionId`. */
  cancel(sessionId: string): Promise<void>;

  /** Close a single driver session (best-effort). */
  closeSession?(sessionId: string): Promise<void>;

  /** Tear down the driver and any underlying subprocess/resources. */
  close(): Promise<void>;

  // --- Optional SDK-specific hooks ---

  /** Steer an active turn with a follow-up user message (Claude, Cursor, Pi). */
  steer?(
    sessionId: string,
    content: string,
    row: MessageRowLike,
    opts?: { payload?: unknown }
  ): Promise<boolean>;

  /** Optional pre-turn usage/subscription-limit gate before opening the driver. */
  checkUsageLimitGate?(ctx: {
    app: AgentApp;
    session: AgentSessionRow;
    agent: AgentRow;
    channel: MessageChannel;
    turnAgentConfigId: number | null;
  }): Promise<{ blocked: true; reason?: string; resetAtMs?: number | null } | null>;

  /** Optional handler invoked when the runtime requests tool/question permission. */
  onPermissionRequest?(handler: DriverPermissionHandler): () => void;

  /** Optional usage/subscription-limit guard created before `prompt`. */
  createUsageGuard?(ctx: DriverContext): Promise<DriverUsageGuard | null>;

  /** Optional SDK-specific usage persistence (defaults to generic usage recording). */
  recordTurnUsage?(opts: DriverRecordUsageOpts): Promise<void>;

  /** Optional tied-session loop compaction hook (Claude). */
  compactBeforeLoop?(app: AgentApp, args: TiedSessionLoopCompactionArgs): Promise<void>;

  /** Optional live settings patch sync (e.g. model change mid-session). */
  onSessionSettingsPatched?(sessionId: string, patch: Record<string, unknown>): Promise<void>;

  /** Optional one-shot text completion (session title/PR description generation). */
  completeText?(params: DriverCompleteTextParams): Promise<string>;

  /** Optional error classifier to map SDK errors to user-facing messages or usage limits. */
  classifyTurnError?(err: unknown): {
    message: string;
    isUsageLimit?: boolean;
    isAbort?: boolean;
  } | null;

  /** Whether this driver rejects SDK-native subagents (e.g. Claude `Task` tool). */
  readonly rejectSubagents?: boolean;
}

/** Factory function registered on an SDK plugin to instantiate a driver per turn/session. */
export type AgentDriverFactory = (opts: {
  app: AgentApp;
  config: Record<string, unknown> | null;
}) => AgentDriver;
