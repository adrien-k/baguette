import {
  type AgentSession as PiAgentSession,
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
} from '@earendil-works/pi-coding-agent';
import type { SessionNotification } from '@agentclientprotocol/sdk/unstable';
import { mkdir } from 'node:fs/promises';
import { writePiUserMcpConfig, readPiUserMcpConfig } from '../../services/user-mcp-runtime.js';
import { addPiTokenUsage, emptyTurnUsage } from '../../services/turn-usage.js';
import type { AgentApp, MessageRowLike } from '../../services/feathers/agent-service-types.ts';
import type {
  AgentDriver,
  DriverCompleteTextParams,
  DriverContext,
  DriverNewSessionParams,
  DriverPromptResult,
  DriverRecordUsageOpts,
  DriverSessionResult,
} from '../driver.ts';
import { toolListToPiCustomTools } from './adapt-tools.js';
import { resolvePiCredentials } from './config.js';
import { createSpillOversizedToolResultsExtension } from './extensions/spill-oversized-tool-results.ts';
import { lunaroutePiAdditionalExtensionPaths } from './lunaroute-extension-path.js';
import { createPiModelRuntime, resolvePiSessionModel } from './models.js';
import { recordPiTurnUsage } from './record-turn-usage.js';
import { piAgentDir, piSessionsDir, piWorktreeCwd } from './session-paths.js';

const PI_METADATA_MODEL_ID = 'claude-haiku-4-5';

function errorDetail(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  return fallback;
}

function assistantTurnErrorMessage(message: Record<string, unknown> | undefined): string | null {
  if (!message || message.role !== 'assistant') return null;
  if (message.stopReason !== 'error') return null;
  return errorDetail(message.errorMessage, 'Model request failed');
}

function extractThinkingBackfill(message: unknown): string | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const msg = message as Record<string, unknown>;
  if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return null;
  const parts: string[] = [];
  for (const block of msg.content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type !== 'thinking' || b.redacted === true) continue;
    if (typeof b.thinking === 'string' && b.thinking.trim()) {
      parts.push(b.thinking);
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}

export class PiDriver implements AgentDriver {
  private readonly app: AgentApp;
  private readonly config: Record<string, unknown> | null;
  private readonly listeners = new Set<(notification: SessionNotification) => void>();
  private ctx: DriverContext | null = null;
  private piSession: PiAgentSession | null = null;
  private modelRuntime: Awaited<ReturnType<typeof createPiModelRuntime>> | null = null;
  private apiKey: string | null = null;
  private envVar = '';

  constructor(app: AgentApp, config: Record<string, unknown> | null) {
    this.app = app;
    this.config = config;
  }

  private emitUpdate(notification: SessionNotification): void {
    for (const listener of this.listeners) {
      listener(notification);
    }
  }

  onUpdate(listener: (notification: SessionNotification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    const { apiKey, envVar } = resolvePiCredentials(this.config);
    if (!apiKey) {
      throw new Error('Pi API key is not configured for this session');
    }
    this.apiKey = apiKey;
    this.envVar = envVar;

    const agentDir = piAgentDir(ctx.session);
    const sessionsDir = piSessionsDir(ctx.session);
    if (agentDir) await mkdir(agentDir, { recursive: true });
    if (sessionsDir) await mkdir(sessionsDir, { recursive: true });

    await writePiUserMcpConfig(agentDir, ctx.userMcpServers ?? {});
    this.modelRuntime = await createPiModelRuntime(apiKey, envVar);
  }

  private async openPiSession(
    params: DriverNewSessionParams,
    storedPiSessionId?: string | null
  ): Promise<DriverSessionResult> {
    if (!this.ctx || !this.modelRuntime) {
      throw new Error('PiDriver not started');
    }
    const { session, agent } = this.ctx;
    const cwd = piWorktreeCwd(session, agent) || params.cwd;
    const agentDir = piAgentDir(session) ?? undefined;
    const sessionsDir = piSessionsDir(session) ?? undefined;
    const settingsManager = SettingsManager.create(cwd, agentDir);

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: agentDir ?? cwd,
      settingsManager,
      appendSystemPrompt: params.systemPromptAppend ? [params.systemPromptAppend] : [],
      additionalExtensionPaths: lunaroutePiAdditionalExtensionPaths(this.envVar),
      extensionFactories: [
        createMcpExtension({ loadConfig: () => readPiUserMcpConfig(agentDir) }),
        createSpillOversizedToolResultsExtension(session.id),
      ],
    });
    await resourceLoader.reload();

    let sessionManager: SessionManager;
    if (storedPiSessionId && sessionsDir) {
      const sessionFile = SessionManager.findById(cwd, storedPiSessionId, sessionsDir);
      sessionManager = sessionFile
        ? SessionManager.open(sessionFile, sessionsDir, cwd)
        : SessionManager.create(cwd, sessionsDir);
    } else {
      sessionManager = SessionManager.create(cwd, sessionsDir);
    }

    const customTools = toolListToPiCustomTools(
      params.tools ?? this.ctx.baguetteTools ?? []
    ) as CreateAgentSessionOptions['customTools'];

    const { session: piSession } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime: this.modelRuntime,
      model: undefined,
      thinkingLevel: undefined,
      customTools,
      resourceLoader,
      settingsManager,
      sessionManager,
    });
    this.piSession = piSession;

    if (typeof piSession.bindExtensions === 'function') {
      await piSession.bindExtensions({});
    }

    if (params.model) {
      const resolved = await resolvePiSessionModel(
        this.modelRuntime,
        params.model,
        this.envVar,
        { apiKey: this.apiKey, config: this.config },
        params.modelParams ?? null
      );
      if (resolved.error || !resolved.model) {
        throw new Error(resolved.error ?? `Could not resolve Pi model "${params.model}"`);
      }
      await piSession.setModel(resolved.model, { thinkingLevel: resolved.thinkingLevel });
    }

    const sessionId = piSession.sessionId || storedPiSessionId || 'pi-session';
    return {
      sessionId,
      storedSessionId: piSession.sessionId ?? null,
    };
  }

  async newSession(params: DriverNewSessionParams): Promise<DriverSessionResult> {
    return this.openPiSession(params, null);
  }

  async resume(
    storedSessionId: string,
    params: DriverNewSessionParams
  ): Promise<DriverSessionResult> {
    return this.openPiSession(params, storedSessionId);
  }

  async prompt(
    sessionId: string,
    content: string,
    opts?: { signal?: AbortSignal }
  ): Promise<DriverPromptResult> {
    if (!this.piSession) throw new Error('PiDriver session not opened');
    const piSession = this.piSession;
    const turnUsage = emptyTurnUsage();
    let turnFailed = false;
    let lastError: string | null = null;
    let thinkingStreamed = false;

    const unsubscribe = piSession.subscribe((rawEvent) => {
      const event = rawEvent as Record<string, unknown>;
      void this.ctx?.appendRawEvent?.(event);

      const type = event.type;
      if (type === 'extension_error') {
        turnFailed = true;
        lastError = errorDetail(event.error, 'Pi extension error');
      } else if (type === 'message_update') {
        const inner = event.assistantMessageEvent as Record<string, unknown> | undefined;
        if (inner?.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta) {
          this.emitUpdate({
            sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: inner.delta },
            },
          });
        } else if (
          inner?.type === 'thinking_delta' &&
          typeof inner.delta === 'string' &&
          inner.delta
        ) {
          thinkingStreamed = true;
          this.emitUpdate({
            sessionId,
            update: {
              sessionUpdate: 'agent_thought_chunk',
              content: { type: 'text', text: inner.delta },
            },
          });
        }
      } else if (type === 'tool_execution_start') {
        const toolCallId = String(event.toolCallId ?? '');
        const toolName = String(event.toolName ?? 'generic');
        this.emitUpdate({
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId,
            title: toolName,
            name: toolName,
            status: 'in_progress',
            rawInput:
              event.args && typeof event.args === 'object' && !Array.isArray(event.args)
                ? (event.args as Record<string, unknown>)
                : {},
          },
        });
      } else if (type === 'tool_execution_end') {
        const toolCallId = String(event.toolCallId ?? '');
        const toolName = String(event.toolName ?? 'generic');
        const isError = Boolean(event.isError);
        this.emitUpdate({
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId,
            name: toolName,
            status: isError ? 'failed' : 'completed',
            rawInput:
              event.args && typeof event.args === 'object' && !Array.isArray(event.args)
                ? (event.args as Record<string, unknown>)
                : undefined,
            rawOutput: event.result,
          },
        });
      } else if (type === 'message_end') {
        const message = event.message as Record<string, unknown> | undefined;
        const turnError = assistantTurnErrorMessage(message);
        if (turnError) {
          turnFailed = true;
          lastError = turnError;
        }
        if (!thinkingStreamed) {
          const backfill = extractThinkingBackfill(message);
          if (backfill) {
            thinkingStreamed = true;
            this.emitUpdate({
              sessionId,
              update: {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: backfill },
              },
            });
          }
        }
      } else if (type === 'turn_end') {
        const message = event.message as Record<string, unknown> | undefined;
        addPiTokenUsage(
          turnUsage,
          message?.usage as Record<string, unknown> | undefined,
          typeof message?.model === 'string' ? message.model : undefined
        );
        const turnError = assistantTurnErrorMessage(message);
        if (turnError) {
          turnFailed = true;
          lastError = turnError;
        } else {
          turnFailed = false;
          lastError = null;
        }
      } else if (type === 'auto_retry_end') {
        if (event.success === false) {
          turnFailed = true;
          lastError = errorDetail(
            event.finalError ?? event.errorMessage,
            'Turn failed after retries'
          );
        } else {
          turnFailed = false;
          lastError = null;
        }
      }
    });

    try {
      await piSession.prompt(content);
    } catch (err) {
      if ((err as Error).name === 'AbortError' || opts?.signal?.aborted) {
        return { stopReason: 'aborted', usage: turnUsage };
      }
      throw err;
    } finally {
      unsubscribe();
    }

    if (opts?.signal?.aborted) {
      return { stopReason: 'aborted', usage: turnUsage };
    }
    if (turnFailed) {
      return {
        stopReason: 'error',
        usage: turnUsage,
        errorMessage: lastError ?? 'Pi agent turn failed',
      };
    }
    return { stopReason: 'end_turn', usage: turnUsage };
  }

  async steer(_sessionId: string, content: string, row: MessageRowLike): Promise<boolean> {
    if (!row.force || !this.piSession?.isStreaming) return false;
    await this.piSession.steer(content).catch(() => {});
    return true;
  }

  async cancel(_sessionId: string): Promise<void> {
    await this.piSession?.abort().catch(() => {});
  }

  async close(): Promise<void> {
    this.piSession = null;
  }

  async recordTurnUsage(opts: DriverRecordUsageOpts): Promise<void> {
    await recordPiTurnUsage(this.app, opts.session, opts.usage, {
      turnModel: {
        model: opts.turnModel.model ?? '',
        modelParams: opts.turnModel.modelParams,
      },
      patchSessionCost: opts.patchSessionCost,
      agentConfigId: opts.agentConfigId,
      agentId: opts.agentId,
    });
  }

  async completeText(params: DriverCompleteTextParams): Promise<string> {
    const { apiKey, envVar } = resolvePiCredentials(this.config);
    if (!apiKey) return '';

    const modelRuntime = await createPiModelRuntime(apiKey, envVar);
    const modelId = params.model || PI_METADATA_MODEL_ID;
    const cwd = params.cwd || process.cwd();
    const settingsManager = SettingsManager.create(cwd, undefined);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: cwd,
      settingsManager,
      additionalExtensionPaths: lunaroutePiAdditionalExtensionPaths(envVar),
    });
    await resourceLoader.reload();
    const sessionManager = SessionManager.inMemory(cwd);
    const { session: piSession } = await createAgentSession({
      cwd,
      modelRuntime,
      model: undefined,
      resourceLoader,
      settingsManager,
      sessionManager,
      customTools: [],
    });

    try {
      const resolved = await resolvePiSessionModel(modelRuntime, modelId, envVar, {
        apiKey,
        config: this.config,
      });
      if (resolved.error || !resolved.model) return '';
      await piSession.setModel(resolved.model, { thinkingLevel: resolved.thinkingLevel });
    } catch {
      return '';
    }

    let collected = '';
    const unsub = piSession.subscribe((event) => {
      if (event.type === 'message_update') {
        const inner = (event as { assistantMessageEvent?: { type?: string; delta?: string } })
          .assistantMessageEvent;
        if (inner?.type === 'text_delta' && typeof inner.delta === 'string') {
          collected += inner.delta;
        }
      }
    });

    const onAbort = () => {
      void piSession.abort().catch(() => {});
    };
    params.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await piSession.prompt(params.prompt);
      return collected.trim();
    } finally {
      params.signal.removeEventListener('abort', onAbort);
      unsub();
      await piSession.abort().catch(() => {});
    }
  }
}
