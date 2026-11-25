/**
 * Unified Feathers agent service backed by an `AgentDriver`.
 *
 * Owns the active-session map, stop/abort, resume persistence, review vs chat
 * channel setup, ACP update streaming to `MessageStreamWriter`, event-log
 * appends, and error/usage handling via `runAgentTurnLifecycle`.
 */

import os from 'node:os';
import logger from '../logger.js';
import { attachAppErrorHandler } from '../lib/app-error-handler.js';
import { usageLimitStatusText } from '../lib/usage-limit.js';
import { buildBaguetteToolList, buildReviewerAgentTools } from '../services/mcp/server.js';
import { loadConfiguredSlackApps } from '../services/mcp/lib/slack.js';
import { loadEnabledMcpServersForSession } from '../services/user-mcp-runtime.js';
import { buildSystemPromptAppend } from '../services/session-prompt.js';
import { emptyTurnUsage } from '../services/turn-usage.js';
import { extractUserTextFromUserPayload } from '../../shared/user-message-content.js';
import { loadOwnedAgentConfigDecrypted } from '../services/agent-context.js';
import { getReviewAgentTurn, reviewTurnKey } from '../services/review-agent-turn.js';
import { agentWorktreeCwd } from '../services/subagent-worktree.js';
import type { MessageOp } from '../../shared/message-types.ts';
import type {
  AgentApp,
  AgentRow,
  AgentSessionRow,
  DbLike,
  MessageChannel,
  MessageRowLike,
  TiedSessionLoopCompactionArgs,
} from '../services/feathers/agent-service-types.ts';
import { directPromptTiedSessionLoopCompaction } from '../services/feathers/loop-compaction.ts';
import { patchAgentInternal } from '../services/feathers/agents.service.js';
import { METADATA_TIMEOUT_MS } from '../services/session-metadata.js';
import {
  handleAgentMessageCreated,
  isAgentSessionResumable,
  persistAgentStatusMessage,
  registerInternalAgentService,
  runAgentTurnLifecycle,
  type BaseTurnSessionState,
  type StoredSessionIdColumn,
} from '../services/agent-service-lifecycle.ts';
import { acpTurnResultOps, mapAcpUpdate, type TrackedToolMeta } from './acp-mapping.ts';
import type {
  AgentDriver,
  AgentDriverFactory,
  DriverContext,
  DriverMcpServersMap,
  DriverPromptUsage,
} from './driver.ts';
import { estimateUsageRowCostUsd } from '../lib/usage-row-cost.js';
import { resolveUsageRecordContext, usageRowTokenFields } from '../lib/usage-record-context.js';

export type GenericAgentPluginConfig = {
  key: string;
  label: string;
  servicePath: string;
  createDriver: AgentDriverFactory;
  storedSessionIdColumn?: StoredSessionIdColumn | null;
  supportsCompactionBeforeLoopRepeat?: boolean;
  registerCompactionHook?: boolean;
  emitAppErrorEvenWithWriter?: boolean;
  compactBeforeLoop?: (app: AgentApp, args: TiedSessionLoopCompactionArgs) => Promise<void>;
};

export type GenericTurnSessionState = BaseTurnSessionState & {
  driver: AgentDriver | null;
  driverSessionId: string | null;
  abortController?: AbortController;
  recordTurnUsage?: AgentDriver['recordTurnUsage'];
};

export const GENERIC_AGENT_SERVICE_METHODS = [
  'handleMessageCreated',
  'stopTurn',
  'stopSession',
  'syncSessionSettingsFromPatch',
  'completeText',
  'isInterruptedSessionResumable',
  'prepareTiedSessionLoopCompaction',
  'usesCompactionBeforeLoopRepeat',
];

function emptyDriverUsage(): DriverPromptUsage {
  return { ...emptyTurnUsage() };
}

async function defaultRecordTurnUsage(
  app: AgentApp,
  sdk: string,
  opts: {
    usage: DriverPromptUsage;
    turnModel: { model: string | null; modelParams: unknown };
    patchSessionCost: boolean;
    agentConfigId: number | null;
    agentId: number;
    session: AgentSessionRow;
  }
): Promise<void> {
  const { usage, turnModel, patchSessionCost, agentConfigId, agentId, session } = opts;
  if (!session || !usage) return;
  const db = app.get('db') as DbLike;
  const { agent, agent_type, snapshot, agent_config_id } = await resolveUsageRecordContext(
    db as never,
    session as never,
    { agentId, turnModel, turnUsage: usage, agentConfigId }
  );

  const costUsd =
    typeof usage.cost_usd === 'number'
      ? usage.cost_usd
      : await estimateUsageRowCostUsd(db as never, usage, snapshot);

  const totalTokens = Number(usage.total_tokens) || 0;
  if (costUsd <= 0 && totalTokens <= 0) return;

  const row: Record<string, unknown> = {
    cost_usd: Math.max(costUsd, 0),
    agent_sdk: agent?.agent_sdk ?? sdk,
    agent_type,
    agent_config_id,
    ...usageRowTokenFields(usage),
    model: snapshot.model,
    model_params: snapshot.model_params,
  };
  if (agent?.id != null) row.agent_id = agent.id;

  await app.service('sessions').insertUsageRow(session, row, {
    patchSessionCost,
    costUsd,
  });
}

export class GenericAgentService {
  readonly plugin: GenericAgentPluginConfig;
  app!: AgentApp;
  _activeSessions = new Map<string | number, GenericTurnSessionState>();
  _handlingMessageIds = new Set<number>();

  constructor(plugin: GenericAgentPluginConfig) {
    this.plugin = plugin;
  }

  setup(app: AgentApp): void {
    this.app = app;
  }

  async handleMessageCreated(row: MessageRowLike): Promise<void> {
    await handleAgentMessageCreated<GenericTurnSessionState>({
      app: this.app,
      row,
      expectedSdk: this.plugin.key,
      handlingMessageIds: this._handlingMessageIds,
      getActiveTurn: (activeKey) => this._activeSessions.get(activeKey),
      isActiveProcessing: (active) => Boolean(active?.isProcessing),
      onActiveTurnMessage: async ({ active, parsed, row: msgRow }) => {
        if (!active?.driver?.steer || !active.driverSessionId) return;
        const text = extractUserTextFromUserPayload(parsed);
        if (!text && !parsed) return;
        await active.driver.steer(active.driverSessionId, text, msgRow, { payload: parsed });
      },
      onStartTurn: ({ session, parsed, row: msgRow, channel, activeKey, agent }) => {
        attachAppErrorHandler(
          this.app,
          this._runTurn(session, parsed, msgRow, {
            turnId: msgRow.turn_id ?? null,
            channel,
            activeKey,
            agent,
          }),
          { userId: session.user_id, sessionId: session.id }
        ).catch((err: Error) => {
          logger.error(
            { sessionId: session.id, err: err.message },
            `${this.plugin.key}-agent turn failed`
          );
        });
      },
    });
  }

  async _runTurn(
    session: AgentSessionRow,
    parsed: unknown,
    row: MessageRowLike,
    meta: {
      turnId?: number | null;
      channel?: MessageChannel;
      activeKey?: string | number;
      agent?: AgentRow;
    } = {}
  ): Promise<void> {
    const sdk = this.plugin.key;
    const logPrefix = `${sdk}-agent`;
    const streamErrorLabel = this.plugin.label;

    await runAgentTurnLifecycle<GenericTurnSessionState, DriverPromptUsage>({
      app: this.app,
      sdk,
      logPrefix,
      streamErrorLabel,
      session,
      row,
      meta,
      activeSessions: this._activeSessions,
      registerCompactionHook: this.plugin.registerCompactionHook !== false,
      emitAppErrorEvenWithWriter: Boolean(this.plugin.emitAppErrorEvenWithWriter),
      createSessionState: ({ userId, agentId, turnId, channel }) => ({
        isProcessing: true,
        userId,
        agentId,
        driver: null,
        driverSessionId: null,
        writer: null,
        turnId,
        channel,
        turnAgentConfigId: null,
      }),
      execute: async ({
        agent,
        channel,
        turnId,
        turnModel,
        turnAgentConfigId,
        writer,
        sessionState,
      }) => {
        if (!writer) {
          throw new Error(`${logPrefix}: missing turn writer`);
        }

        const sessionId = session.id;
        const userId = session.user_id;
        const db = this.app.get('db') as DbLike;
        const config =
          turnAgentConfigId != null
            ? ((await loadOwnedAgentConfigDecrypted(
                turnAgentConfigId,
                userId,
                db as never
              )) as Record<string, unknown> | null)
            : null;

        const cwd = agentWorktreeCwd(session, agent) || os.homedir();
        const userMcpServers = ((await loadEnabledMcpServersForSession(this.app, session, {
          withDescription: true,
        })) ?? {}) as DriverMcpServersMap;

        let baguetteTools;
        let systemPromptAppend: string | null = null;

        if (channel === 'review') {
          const extras = getReviewAgentTurn(this.app).peekTurnExtras(sessionId) ?? {};
          const ctx = await getReviewAgentTurn(this.app).prepareReviewContext(session, agent, {
            extraPrompt: extras.extraPrompt,
            model: turnModel.model,
            modelParams: turnModel.modelParams,
            agentSdk: sdk,
          });
          baguetteTools = buildReviewerAgentTools(session, this.app, ctx.turnAgent);
          systemPromptAppend = ctx.systemPrompt || null;
        } else {
          const slackApps = await loadConfiguredSlackApps(db as never, userId);
          baguetteTools = await buildBaguetteToolList(session, this.app, {
            slackApps,
            agent,
          });
          systemPromptAppend = await buildSystemPromptAppend(session, {
            agent,
            db,
            agentSdk: sdk,
            app: this.app,
          });
        }

        const driver = this.plugin.createDriver({ app: this.app, config });
        if (driver.checkUsageLimitGate) {
          const gate = await driver.checkUsageLimitGate({
            app: this.app,
            session,
            agent,
            channel,
            turnAgentConfigId,
          });
          if (gate?.blocked) {
            if (channel === 'review') {
              const msg = usageLimitStatusText({
                label: streamErrorLabel,
                reason: gate.reason,
                action: 'stop',
                resetAtMs: gate.resetAtMs ?? null,
              });
              return {
                outcome: 'failed',
                turnUsage: emptyDriverUsage(),
                error_message: msg,
              };
            }
            await this.app.service('sessions').onUsageLimit(sessionId, agent.id, {
              label: streamErrorLabel,
              sdk,
              reason: gate.reason,
              reset_at_ms: gate.resetAtMs ?? null,
            });
            return {
              outcome: 'stopped',
              turnUsage: emptyDriverUsage(),
            };
          }
        }
        sessionState.driver = driver;
        if (driver.recordTurnUsage) {
          sessionState.recordTurnUsage = driver.recordTurnUsage.bind(driver);
        }

        const controller = new AbortController();
        sessionState.abortController = controller;

        const driverCtx: DriverContext = {
          app: this.app,
          sdk,
          session,
          agent,
          channel,
          userId,
          turnId,
          turnModel,
          turnAgentConfigId,
          cwd,
          userMcpServers,
          baguetteTools,
          systemPromptAppend,
          row,
          writer,
          appendRawEvent: (ev) => writer.log(ev),
        };

        const toolMetaById = new Map<string, TrackedToolMeta>();
        let applyChain: Promise<void> = Promise.resolve();
        let turnResultRecorded = false;
        let streamStarted = false;

        const applyOps = (ops: MessageOp[] | null | undefined) => {
          if (!ops?.length) return;
          const effective = controller.signal.aborted
            ? ops.filter((op) => op.op !== 'turn_result')
            : ops;
          if (!effective.length) return;
          for (const op of effective) {
            if (op.op === 'turn_result') turnResultRecorded = true;
            if (op.op === 'tool_start') {
              const prev = toolMetaById.get(op.call_id) ?? {};
              toolMetaById.set(op.call_id, {
                name: op.name && op.name !== 'generic' ? op.name : prev.name,
                input:
                  Object.keys(op.input).length > 0
                    ? { ...(prev.input ?? {}), ...op.input }
                    : prev.input,
              });
            }
          }
          applyChain = applyChain.then(() => writer.apply(effective));
        };

        const unsubscribe = driver.onUpdate((notification) => {
          void writer.log(notification);
          const update = notification?.update;
          if (!update) return;
          const toolCallId = (update as { toolCallId?: unknown }).toolCallId;
          const trackedMeta =
            typeof toolCallId === 'string' ? toolMetaById.get(toolCallId) : undefined;
          const ops = mapAcpUpdate(update, trackedMeta);
          if (ops?.length) applyOps(ops);
        });

        let driverSessionId: string | null = null;
        let usageGuard: Awaited<ReturnType<NonNullable<AgentDriver['createUsageGuard']>>> = null;

        try {
          await driver.start(driverCtx);

          const storedCol = this.plugin.storedSessionIdColumn ?? null;
          const storedId = storedCol ? (agent[storedCol] as string | null | undefined) : null;
          const openParams = {
            cwd,
            tools: baguetteTools,
            systemPromptAppend,
            model: turnModel.model,
            modelParams: turnModel.modelParams,
          };

          const opened = storedId
            ? await driver.resume(String(storedId), openParams)
            : await driver.newSession(openParams);

          driverSessionId = opened.sessionId;
          sessionState.driverSessionId = driverSessionId;

          if (storedCol && opened.storedSessionId && opened.storedSessionId !== storedId) {
            await patchAgentInternal(
              this.app,
              agent.id,
              { [storedCol]: opened.storedSessionId },
              userId
            );
          }

          if (driver.createUsageGuard) {
            usageGuard = await driver.createUsageGuard(driverCtx);
          }

          streamStarted = true;
          const userText = extractUserTextFromUserPayload(parsed);
          const promptResult = await driver.prompt(driverSessionId, userText, {
            signal: controller.signal,
            payload: parsed,
          });

          if (promptResult.awaitingUser) {
            sessionState.endTurnAwaitingUser = true;
          }

          if (controller.signal.aborted || promptResult.stopReason === 'aborted') {
            await applyChain;
            return {
              outcome: 'stopped',
              turnUsage: promptResult.usage ?? emptyDriverUsage(),
              reviewExtra: promptResult.reviewExtra,
            };
          }

          if (promptResult.stopReason === 'error' || promptResult.stopReason === 'refusal') {
            const msg =
              promptResult.errorMessage ??
              (promptResult.stopReason === 'refusal'
                ? 'Model refused to respond'
                : `${streamErrorLabel} turn failed`);
            if (!turnResultRecorded) {
              applyOps(acpTurnResultOps('error', msg));
            }
            await applyChain;
            return {
              outcome: 'failed',
              turnUsage: promptResult.usage ?? emptyDriverUsage(),
              error_message: msg,
              reviewExtra: promptResult.reviewExtra,
            };
          }

          if (!turnResultRecorded) {
            const rawCost = promptResult.usage?.cost_usd ?? promptResult.usage?.total_cost_usd;
            const cost = typeof rawCost === 'number' ? rawCost : 0;
            applyOps(acpTurnResultOps('ok', null, cost));
          }
          await applyChain;
          return {
            outcome: 'completed',
            turnUsage: promptResult.usage ?? emptyDriverUsage(),
            reviewExtra: promptResult.reviewExtra,
          };
        } catch (err) {
          if ((err as Error).name === 'AbortError' || controller.signal.aborted) {
            return { outcome: 'stopped', turnUsage: emptyDriverUsage() };
          }
          const classified = driver.classifyTurnError?.(err);
          const message = classified?.message ?? (err as Error).message;
          if (streamStarted && !turnResultRecorded && !controller.signal.aborted) {
            applyOps(acpTurnResultOps('error', message));
            await applyChain.catch(() => {});
          }
          if (!streamStarted) {
            await this._recordTurnError(writer, message);
          } else {
            await persistAgentStatusMessage(this.app, {
              sessionId,
              userId,
              statusText: message,
              agentSdk: sdk,
              channel,
              builderAgentId: agent.id,
            }).catch(() => {});
          }
          throw err;
        } finally {
          unsubscribe();
          usageGuard?.dispose?.();
          await applyChain.catch(() => {});
          await writer.finish().catch(() => {});
          if (driverSessionId && driver.closeSession) {
            await driver.closeSession(driverSessionId).catch(() => {});
          }
          await driver.close().catch(() => {});
        }
      },
      recordTurnUsage: async (usage, opts) => {
        const active = this._activeSessions.get(meta.activeKey ?? session.id);
        if (active?.recordTurnUsage) {
          await active.recordTurnUsage({
            usage,
            turnModel: opts.turnModel,
            patchSessionCost: opts.patchSessionCost,
            agentConfigId: opts.agentConfigId,
            agentId: opts.agentId,
            session,
            channel: meta.channel ?? 'chat',
            turnId: meta.turnId ?? null,
          });
          return;
        }
        await defaultRecordTurnUsage(this.app, sdk, {
          usage,
          turnModel: opts.turnModel,
          patchSessionCost: opts.patchSessionCost,
          agentConfigId: opts.agentConfigId,
          agentId: opts.agentId,
          session,
        });
      },
      recordTurnError: (writer, message) => this._recordTurnError(writer, message),
    });
  }

  async _recordTurnError(
    writer: { apply: (ops: MessageOp[]) => Promise<void> } | null | undefined,
    message: string
  ): Promise<void> {
    const text = String(message ?? '').trim();
    if (!writer || !text) return;
    await writer.apply(acpTurnResultOps('error', text));
  }

  async stopTurn(activeKey: string | number): Promise<void> {
    const active = this._activeSessions.get(activeKey);
    if (!active) return;
    try {
      active.abortController?.abort();
      if (active.driver && active.driverSessionId) {
        await active.driver.cancel(active.driverSessionId);
      }
    } catch {
      // ignore cancellation errors
    }
    this._activeSessions.delete(activeKey);
  }

  async stopSession(sessionId: number): Promise<void> {
    await this.stopTurn(sessionId);
    await this.stopTurn(reviewTurnKey(sessionId));
  }

  getActiveSession(sessionId: string | number): GenericTurnSessionState | null {
    return this._activeSessions.get(sessionId) ?? null;
  }

  async syncSessionSettingsFromPatch(
    sessionId: number,
    sessionRow: AgentSessionRow
  ): Promise<void> {
    const active = this.getActiveSession(sessionId);
    if (!active?.driver?.onSessionSettingsPatched || !active.driverSessionId) return;
    await active.driver.onSessionSettingsPatched(
      active.driverSessionId,
      sessionRow as Record<string, unknown>
    );
  }

  async get(id: number): Promise<GenericTurnSessionState | null> {
    return this.getActiveSession(id);
  }

  async completeText(
    promptOrOpts:
      | string
      | {
          userId?: number | null;
          agentConfigId?: number | null;
          cwd?: string;
          prompt: string;
          model?: string | null;
          modelParams?: unknown;
        },
    maybeOpts?: {
      userId?: number | null;
      agentConfigId?: number | null;
      cwd?: string;
      model?: string | null;
      modelParams?: unknown;
    }
  ): Promise<string> {
    const opts =
      typeof promptOrOpts === 'string'
        ? { ...(maybeOpts ?? {}), prompt: promptOrOpts }
        : promptOrOpts;
    const controller = new AbortController();
    const db = this.app.get('db') as DbLike;
    const config =
      opts.agentConfigId != null && opts.userId != null
        ? ((await loadOwnedAgentConfigDecrypted(opts.agentConfigId, opts.userId, db as never).catch(
            () => null
          )) as Record<string, unknown> | null)
        : null;
    const driver = this.plugin.createDriver({ app: this.app, config });
    if (!driver.completeText) return '';

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve('');
        }, METADATA_TIMEOUT_MS);
      });
      return await Promise.race([
        driver.completeText({
          app: this.app,
          userId: opts.userId ?? 0,
          agentConfigId: opts.agentConfigId,
          cwd: opts.cwd || os.homedir(),
          prompt: opts.prompt,
          model: opts.model ?? null,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      logger.warn(
        { sdk: this.plugin.key, err: (err as Error).message },
        `${this.plugin.key}-agent: completeText failed`
      );
      return '';
    } finally {
      if (timer) clearTimeout(timer);
      await driver.close().catch(() => {});
    }
  }

  async isInterruptedSessionResumable(
    session: AgentSessionRow,
    opts: { channel?: MessageChannel; agent?: AgentRow } = {}
  ): Promise<boolean> {
    const col = this.plugin.storedSessionIdColumn;
    if (!col) return false;
    return isAgentSessionResumable(this.app, session, col, opts);
  }

  async prepareTiedSessionLoopCompaction(args: TiedSessionLoopCompactionArgs): Promise<void> {
    if (this.plugin.compactBeforeLoop) {
      await this.plugin.compactBeforeLoop(this.app, args);
      return;
    }
    await directPromptTiedSessionLoopCompaction(this.app, args);
  }

  usesCompactionBeforeLoopRepeat(): boolean {
    return Boolean(this.plugin.supportsCompactionBeforeLoopRepeat);
  }
}

export function registerGenericAgentService(
  app: AgentApp,
  plugin: GenericAgentPluginConfig,
  servicePath?: string
): GenericAgentService {
  const service = new GenericAgentService(plugin);
  return registerInternalAgentService(app, {
    service,
    path: servicePath ?? plugin.servicePath,
    methods: GENERIC_AGENT_SERVICE_METHODS,
    key: plugin.key,
    label: plugin.label,
  });
}
