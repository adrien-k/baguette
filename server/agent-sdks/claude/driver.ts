import {
  query,
  type Options as ClaudeSdkOptions,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import type { SessionNotification } from '@agentclientprotocol/sdk/unstable';
import { resolveDataDirRelativePath } from '../../config.js';
import logger from '../../logger.js';
import { createMessageChannel, type MessageChannelHandle } from '../../services/message-channel.js';
import { getAllowedCommandsFromUser } from '../../services/agent-settings.js';
import { getPrimaryBuilderAgent } from '../../services/agents-db.js';
import { applyClaudeAgentModelEnv, getClaudeEnv } from './env.js';
import { patchAgentInternal } from '../../services/feathers/agents.service.js';
import { loadEnabledMcpServersForSession } from '../../services/user-mcp-runtime.js';
import { agentWorktreeCwd } from '../../services/subagent-worktree.js';
import { allowsOverage } from '../../lib/usage-limit.js';
import { isBaguetteUserMessage } from '../../../shared/turn-model.js';
import { normalizeUserMessageForAgentSdk } from '../../../shared/user-message-content.js';
import type { UserMessagePayload } from '../../../shared/message-types.ts';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  DbLike,
  MessageChannel,
  MessageRowLike,
} from '../../services/feathers/agent-service-types.ts';
import type {
  AgentDriver,
  DriverCompleteTextParams,
  DriverContext,
  DriverNewSessionParams,
  DriverPromptResult,
  DriverPromptUsage,
  DriverRecordUsageOpts,
  DriverSessionResult,
} from '../driver.ts';
import { toolListToClaudeMcpServer } from './adapt-tools.js';
import { applyClaudeModelParamsToQueryInstance } from './sdk-options.js';
import { claudeSdkOptionsFromModelParams } from './sdk-options.js';
import { recordClaudeTurnUsage } from './record-turn-usage.js';
import { claudeSdkSubagentDenyResult } from './reject-sdk-subagent.js';
import { ClaudeUsageLimitGuard, type ClaudeUsageLimitHit } from './usage-limit.js';
import { getLastResultTotals } from './usage-totals.js';

const REVIEWER_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];
const POST_RESULT_CONTINUATION_MS = 60_000;

type TaskStartedMessage = SDKMessage & {
  ambient?: boolean;
  task_id?: string;
  is_backgrounded?: boolean;
};

function commandsToAllowedTools(commands: string[]): string[] {
  return commands.map((cmd) => `Bash(${cmd}*)`);
}

function toSdkUserMessage(prompt: unknown): SDKUserMessage {
  if (prompt && typeof prompt === 'object') return prompt as SDKUserMessage;
  return {
    type: 'user',
    message: { role: 'user', content: (prompt as string) ?? '' },
    parent_tool_use_id: null,
    session_id: '',
  };
}

function toClaudeSdkUserPayload(parsedStorage: unknown): unknown {
  if (!parsedStorage || typeof parsedStorage !== 'object') return parsedStorage;
  let forSdk: Record<string, unknown> = parsedStorage as Record<string, unknown>;
  if (
    isBaguetteUserMessage(parsedStorage) &&
    typeof (parsedStorage as UserMessagePayload).content === 'string'
  ) {
    const baguette = parsedStorage as UserMessagePayload;
    forSdk = {
      type: 'user',
      source: 'baguette',
      title: baguette.title,
      message: { role: 'user', content: baguette.content },
    };
  } else if (typeof (parsedStorage as { content?: unknown }).content === 'string') {
    forSdk = {
      type: 'user',
      message: { role: 'user', content: (parsedStorage as { content: string }).content },
    };
  } else if (Array.isArray((parsedStorage as { content?: unknown }).content)) {
    forSdk = {
      type: 'user',
      message: {
        role: 'user',
        content: (parsedStorage as { content: unknown[] }).content,
      },
    };
  }
  return normalizeUserMessageForAgentSdk(forSdk);
}

function isModelLessResultMessage(message: SDKMessage): boolean {
  const result = message as {
    subtype?: string;
    is_error?: boolean;
    num_turns?: number;
    result?: string;
  };
  return (
    result.subtype === 'success' &&
    !result.is_error &&
    result.num_turns === 0 &&
    (result.result ?? '') === ''
  );
}

function shouldTrackTaskStarted(message: TaskStartedMessage): boolean {
  if (message.ambient) return false;
  if (!message.task_id) return false;
  if (message.is_backgrounded === false) return false;
  return true;
}

function buildPartialLimitResult(
  sessionId: number,
  partial: Record<string, Record<string, number>> | null | undefined
): SDKResultMessage | null {
  if (!partial) return null;
  const prev = getLastResultTotals(sessionId).models as Record<string, Record<string, number>>;
  const modelUsage: Record<string, Record<string, number>> = {};
  for (const [model, used] of Object.entries(partial)) {
    const before = prev?.[model] ?? {};
    modelUsage[model] = Object.fromEntries(
      Object.entries(used).map(([field, n]) => [field, (before[field] ?? 0) + n])
    );
  }
  return { type: 'result', modelUsage } as unknown as SDKResultMessage;
}

function mapClaudeMsgToAcp(sessionId: string, msg: SDKMessage): SessionNotification[] {
  const out: SessionNotification[] = [];
  if (msg.type === 'assistant') {
    const content = (msg as { message?: { content?: unknown[] } }).message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string' && b.text) {
          out.push({
            sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: b.text },
            },
          });
        } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking) {
          out.push({
            sessionId,
            update: {
              sessionUpdate: 'agent_thought_chunk',
              content: { type: 'text', text: b.thinking },
            },
          });
        } else if (
          b.type === 'tool_use' &&
          typeof b.id === 'string' &&
          typeof b.name === 'string'
        ) {
          out.push({
            sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: b.id,
              title: b.name,
              name: b.name,
              status: 'in_progress',
              rawInput:
                b.input && typeof b.input === 'object' && !Array.isArray(b.input)
                  ? (b.input as Record<string, unknown>)
                  : {},
            },
          });
        }
      }
    }
  } else if (msg.type === 'user') {
    const content = (msg as { message?: { content?: unknown[] } }).message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          const isError = Boolean(b.is_error);
          out.push({
            sessionId,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: b.tool_use_id,
              status: isError ? 'failed' : 'completed',
              rawOutput: b.content,
            },
          });
        }
      }
    }
  }
  return out;
}

export class ClaudeDriver implements AgentDriver {
  readonly rejectSubagents = true;
  private readonly app: AgentApp;
  private readonly config: Record<string, unknown> | null;
  private readonly listeners = new Set<(notification: SessionNotification) => void>();
  private ctx: DriverContext | null = null;
  private channel: MessageChannelHandle | null = null;
  private queryInstance: Query | null = null;
  private abortController: AbortController | null = null;
  private claudeEnv: Record<string, string> = {};
  private awaitingUser = false;

  constructor(app: AgentApp, config: Record<string, unknown> | null) {
    this.app = app;
    this.config = config;
  }

  onUpdate(listener: (notification: SessionNotification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(n: SessionNotification): void {
    for (const listener of this.listeners) {
      listener(n);
    }
  }

  private createCanUseTool() {
    return async (toolName: string, input: Record<string, unknown>): Promise<PermissionResult> => {
      if (toolName === 'ExitPlanMode') {
        this.awaitingUser = true;
        return {
          behavior: 'allow',
          updatedInput: input,
          message:
            'Plan saved for user review in chat. The turn can complete; the user will message when ready to execute or refine.',
        } as PermissionResult;
      }
      if (toolName === 'AskUserQuestion') {
        this.awaitingUser = true;
        return {
          behavior: 'deny',
          message: 'Questions presented to the user inline. They will reply with their answers.',
        };
      }
      const sdkSubagentDeny = claudeSdkSubagentDenyResult(toolName);
      if (sdkSubagentDeny) return sdkSubagentDeny;
      return { behavior: 'allow', updatedInput: input };
    };
  }

  async start(ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.claudeEnv = await getClaudeEnv(this.app, ctx.userId, ctx.turnAgentConfigId);
  }

  private async openQuery(
    params: DriverNewSessionParams,
    resumeId?: string
  ): Promise<DriverSessionResult> {
    if (!this.ctx) throw new Error('ClaudeDriver not started');
    const { session, agent, channel } = this.ctx;
    const model = params.model || (agent.model as string) || '';
    if (!model) throw new Error('Model is required to run this turn');

    const cwd =
      agentWorktreeCwd(session, agent) ||
      session.absolute_session_path ||
      resolveDataDirRelativePath(session.session_path) ||
      params.cwd;

    const resolvedMcp = toolListToClaudeMcpServer(params.tools ?? this.ctx.baguetteTools ?? []);
    const userMcp = await loadEnabledMcpServersForSession(this.app, session);

    let plugins: Array<{ type: 'local'; path: string }> = [];
    if (channel !== 'review' && session.plugins) {
      try {
        const pluginIds: unknown = JSON.parse(session.plugins);
        if (Array.isArray(pluginIds) && pluginIds.length > 0) {
          const pluginRows = await (this.app.get('db') as DbLike)('plugins').whereIn(
            'id',
            pluginIds
          );
          plugins = (pluginRows || []).map((p) => ({
            type: 'local' as const,
            path: resolveDataDirRelativePath(p.local_path as string) ?? '',
          }));
        }
      } catch {
        // ignore malformed plugins JSON
      }
    }

    const allowedTools =
      channel === 'review'
        ? REVIEWER_ALLOWED_TOOLS
        : commandsToAllowedTools(getAllowedCommandsFromUser());

    const paramOptions = claudeSdkOptionsFromModelParams(params.modelParams);
    const queryOptions: ClaudeSdkOptions = {
      cwd,
      env: applyClaudeAgentModelEnv(this.claudeEnv, model),
      ...(resumeId ? { resume: resumeId } : {}),
      model,
      ...paramOptions,
      tools: { type: 'preset', preset: 'claude_code' },
      settingSources: (channel === 'review' ? [] : ['project']) as SettingSource[],
      mcpServers: { ...userMcp, baguette: resolvedMcp } as ClaudeSdkOptions['mcpServers'],
      permissionMode: 'acceptEdits' as PermissionMode,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: params.systemPromptAppend ?? '',
      },
      canUseTool: this.createCanUseTool(),
      ...(allowedTools.length ? { allowedTools } : {}),
      ...(plugins.length ? { plugins } : {}),
    };

    this.channel = createMessageChannel();
    this.abortController = new AbortController();
    this.queryInstance = query({
      prompt: this.channel as unknown as AsyncIterable<SDKUserMessage>,
      options: { ...queryOptions, abortController: this.abortController },
    });

    if (params.modelParams != null) {
      void applyClaudeModelParamsToQueryInstance(this.queryInstance, params.modelParams).catch(
        (err: Error) => {
          logger.warn(
            { sessionId: session.id, err: err.message },
            'claude-agent: failed to apply model params to query'
          );
        }
      );
    }

    return {
      sessionId: resumeId || 'claude-session',
      storedSessionId: resumeId || null,
    };
  }

  async newSession(params: DriverNewSessionParams): Promise<DriverSessionResult> {
    return this.openQuery(params);
  }

  async resume(
    storedSessionId: string,
    params: DriverNewSessionParams
  ): Promise<DriverSessionResult> {
    return this.openQuery(params, storedSessionId);
  }

  async checkUsageLimitGate({
    app,
    session,
    agent,
    turnAgentConfigId,
  }: {
    app: AgentApp;
    session: AgentSessionRow;
    agent: AgentRow;
    channel: MessageChannel;
    turnAgentConfigId: number | null;
  }): Promise<{ blocked: true; reason?: string; resetAtMs?: number | null } | null> {
    const blocked = await app
      .service('sessions')
      .checkUsageLimitGate(session.id, agent.id, { agentConfigId: turnAgentConfigId });
    if (!blocked) return null;
    return {
      blocked: true,
      reason: blocked.reason,
      resetAtMs: blocked.reset_at_ms,
    };
  }

  async onSessionSettingsPatched(
    _driverSessionId: string,
    _patch: Record<string, unknown>
  ): Promise<void> {
    if (!this.queryInstance || !this.ctx) return;
    try {
      const builder = (await getPrimaryBuilderAgent(this.app.get('db'), this.ctx.session.id)) as
        AgentRow | undefined;
      if (!builder) return;
      this.queryInstance.setModel((builder.model as string) ?? undefined);
      await applyClaudeModelParamsToQueryInstance(this.queryInstance, builder.model_params);
    } catch (err) {
      logger.warn(
        { sessionId: this.ctx.session.id, err: (err as Error).message },
        'claude-agent: failed to sync model params from session patch'
      );
    }
  }

  async prompt(
    sessionId: string,
    content: string,
    opts?: { signal?: AbortSignal; payload?: unknown }
  ): Promise<DriverPromptResult> {
    if (!this.ctx || !this.queryInstance || !this.channel) {
      throw new Error('ClaudeDriver session not opened');
    }
    const { session, agent, userId, channel } = this.ctx;
    const isReview = channel === 'review';
    const trackBackgroundTasks = !isReview;
    let usageLimitHit: ClaudeUsageLimitHit | null = null;
    let lastResult: SDKResultMessage | null = null;
    let modelLessResult: SDKResultMessage | null = null;
    let turnComplete = false;
    const pendingBackgroundTaskIds = new Set<string>();
    let awaitingStreamContinuation = false;
    let continuationDeadline: number | null = null;

    const guard = !isReview
      ? new ClaudeUsageLimitGuard({
          overage: allowsOverage(session.usage_limit_action as string),
          usageLimitUsd: (session.usage_limit as number | null | undefined) ?? null,
          priorSpentUsd: (session.usage_limit_spent as number | undefined) ?? 0,
        })
      : null;

    const onAbort = () => {
      this.abortController?.abort();
    };
    opts?.signal?.addEventListener('abort', onAbort, { once: true });

    const initialPayload = opts?.payload != null ? toClaudeSdkUserPayload(opts.payload) : content;
    this.channel.push(toSdkUserMessage(initialPayload));

    try {
      for await (const msg of this.queryInstance) {
        if (opts?.signal?.aborted) break;
        await this.ctx.appendRawEvent?.(msg);

        if (
          msg.type === 'system' &&
          (msg as { subtype?: string; session_id?: string }).subtype === 'init' &&
          (msg as { session_id?: string }).session_id
        ) {
          const claudeId = (msg as { session_id: string }).session_id;
          await patchAgentInternal(
            this.app,
            agent.id,
            { claude_session_id: claudeId },
            userId
          ).catch(() => {});
        }

        if (trackBackgroundTasks) {
          const m = msg as SDKMessage & {
            ambient?: boolean;
            task_id?: string;
            status?: string;
          };
          if (msg.type === 'system' && (m as { subtype?: string }).subtype === 'task_started') {
            if (shouldTrackTaskStarted(m as TaskStartedMessage) && m.task_id) {
              pendingBackgroundTaskIds.add(m.task_id);
            }
          }
          if (
            msg.type === 'system' &&
            (m as { subtype?: string }).subtype === 'task_notification' &&
            !m.ambient
          ) {
            const taskStatus = m.status;
            const isTerminal =
              taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'error';
            if (isTerminal && m.task_id) {
              pendingBackgroundTaskIds.delete(m.task_id);
              if (turnComplete && pendingBackgroundTaskIds.size === 0) {
                awaitingStreamContinuation = true;
                continuationDeadline = Date.now() + POST_RESULT_CONTINUATION_MS;
              }
            }
          }
        }

        if (guard) {
          let hit = guard.observe(msg);
          if (!hit && guard.checkpointDue()) {
            const blocked = await this.app
              .service('sessions')
              .checkUsageLimitGate(session.id, agent.id, {
                agentConfigId: this.ctx.turnAgentConfigId ?? null,
              })
              .catch(() => null);
            if (blocked) {
              hit = { reason: blocked.reason, resetAtMs: blocked.reset_at_ms };
            }
          }
          if (hit) {
            usageLimitHit = hit;
            if (msg.type === 'result') lastResult = msg as SDKResultMessage;
            this.abortController?.abort();
            break;
          }
        }

        for (const n of mapClaudeMsgToAcp(sessionId, msg)) {
          this.emit(n);
        }

        if (msg.type === 'result') {
          if (isModelLessResultMessage(msg)) {
            modelLessResult = msg as SDKResultMessage;
            continue;
          }
          turnComplete = true;
          awaitingStreamContinuation = false;
          continuationDeadline = null;
          lastResult = msg as SDKResultMessage;
        }

        if (turnComplete && pendingBackgroundTaskIds.size === 0) {
          if (awaitingStreamContinuation) {
            if (continuationDeadline != null && Date.now() >= continuationDeadline) {
              awaitingStreamContinuation = false;
              continuationDeadline = null;
              break;
            }
          } else {
            break;
          }
        }

        if (awaitingStreamContinuation && msg.type !== 'result') {
          continuationDeadline = Date.now() + POST_RESULT_CONTINUATION_MS;
        }
      }

      if (modelLessResult && !turnComplete && !usageLimitHit) {
        turnComplete = true;
        lastResult = modelLessResult;
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError' || !usageLimitHit) {
        if ((err as Error).name === 'AbortError' || opts?.signal?.aborted) {
          return { stopReason: 'aborted' };
        }
        throw err;
      }
    } finally {
      opts?.signal?.removeEventListener('abort', onAbort);
    }

    if (guard && guard.spentUsd > 0) {
      const db = this.app.get('db') as {
        (table: string): {
          where: (q: Record<string, unknown>) => {
            increment: (col: string, val: number) => Promise<unknown>;
          };
        };
      };
      await db('sessions')
        .where({ id: session.id })
        .increment('usage_limit_spent', guard.spentUsd)
        .catch((err: Error) => {
          logger.warn(
            { sessionId: session.id, err: err.message },
            'claude-agent: failed to record overage spend'
          );
        });
    }

    if (usageLimitHit && !isReview) {
      const limitResult =
        lastResult ?? buildPartialLimitResult(session.id, guard?.partialModelUsageSinceResult());
      if (limitResult) {
        await recordClaudeTurnUsage(this.app, session, limitResult, {
          turnModel: this.ctx.turnModel,
          totalsKey: session.id,
          patchSessionCost: true,
          agentConfigId: this.ctx.turnAgentConfigId,
          agentId: agent.id,
        }).catch(() => {});
      }
      await this.app.service('sessions').onUsageLimit(session.id, agent.id, {
        label: 'Claude',
        sdk: 'claude',
        reason: usageLimitHit.reason,
        reset_at_ms: usageLimitHit.resetAtMs,
      });
      return { stopReason: 'aborted' };
    }

    if (opts?.signal?.aborted) {
      return { stopReason: 'aborted' };
    }

    const usage = (lastResult as unknown as DriverPromptUsage) ?? null;

    if (!lastResult || lastResult.is_error) {
      const errors = (lastResult as { errors?: string[] } | null)?.errors;
      const errMsg =
        (Array.isArray(errors) && errors[0]) ||
        (lastResult
          ? `Claude turn failed (${lastResult.subtype})`
          : 'Claude query ended without a result');
      return {
        stopReason: 'error',
        usage,
        awaitingUser: this.awaitingUser,
        errorMessage: errMsg,
      };
    }

    return {
      stopReason: 'end_turn',
      usage,
      awaitingUser: this.awaitingUser,
    };
  }

  async steer(
    _sessionId: string,
    content: string,
    _row: MessageRowLike,
    opts?: { payload?: unknown }
  ): Promise<boolean> {
    if (!this.channel) return false;
    const payload = opts?.payload != null ? toClaudeSdkUserPayload(opts.payload) : content;
    this.channel.push(toSdkUserMessage(payload));
    return true;
  }

  async cancel(_sessionId: string): Promise<void> {
    this.abortController?.abort();
  }

  async close(): Promise<void> {
    const q = this.queryInstance;
    this.queryInstance = null;
    this.channel = null;
    if (q) {
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setTimeout(r, 50));
      try {
        q.close();
      } catch {
        // ignore close errors
      }
    }
  }

  async recordTurnUsage(opts: DriverRecordUsageOpts): Promise<void> {
    await recordClaudeTurnUsage(this.app, opts.session, opts.usage as never, {
      turnModel: opts.turnModel,
      totalsKey: opts.channel === 'review' ? `review:${opts.session.id}` : opts.session.id,
      patchSessionCost: opts.patchSessionCost,
      agentConfigId: opts.agentConfigId,
      agentId: opts.agentId,
    });
  }

  async completeText(params: DriverCompleteTextParams): Promise<string> {
    const model = params.model || 'haiku';
    const env = applyClaudeAgentModelEnv(
      await getClaudeEnv(this.app, params.userId, params.agentConfigId ?? null),
      params.model ?? null
    );
    const q = query({ prompt: params.prompt, options: { model, env } });
    const onAbort = () => {
      try {
        q.close();
      } catch {
        // ignore
      }
    };
    params.signal.addEventListener('abort', onAbort, { once: true });
    let text = '';
    try {
      for await (const message of q) {
        const msg = message as SDKMessage & {
          subtype?: string;
          is_error?: boolean;
          result?: string;
        };
        if (msg.type === 'result' && msg.subtype === 'success' && !msg.is_error) {
          text = (msg.result || '').trim();
        }
      }
      return text;
    } finally {
      params.signal.removeEventListener('abort', onAbort);
      try {
        q.close();
      } catch {
        // ignore
      }
    }
  }
}
