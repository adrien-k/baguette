import {
  Agent,
  AgentBusyError,
  UnsupportedRunOperationError,
  type Agent as SDKAgent,
  type AgentOptions,
  type ModelParameterValue,
  type Run,
  type RunResult,
  type SDKMessage,
  type SDKStatusMessage,
  type SDKToolUseMessage,
  type SettingSource,
} from '@cursor/sdk';
import { SqliteLocalAgentStore } from '@cursor/sdk/sqlite';
import type { SessionNotification } from '@agentclientprotocol/sdk/unstable';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DATA_DIR, resolveDataDirRelativePath } from '../../config.js';
import logger from '../../logger.js';
import { loadModelsForSdk } from '../../services/baguette-models-for-user.js';
import { agentWorktreeCwd } from '../../services/subagent-worktree.js';
import { addTokenUsage, emptyTurnUsage } from '../../services/turn-usage.js';
import { parseCursorModelPrefsJson } from '../../../shared/cursor-model-prefs.js';
import { resolveCursorAgentModelParams } from './model-params.js';
import type {
  AgentApp,
  AgentSessionRow,
  MessageRowLike,
} from '../../services/feathers/agent-service-types.ts';
import type {
  AgentDriver,
  DriverCompleteTextParams,
  DriverContext,
  DriverNewSessionParams,
  DriverPromptResult,
  DriverRecordUsageOpts,
  DriverSessionResult,
} from '../driver.ts';
import { toolListToCursorCustomTools } from './adapt-tools.js';
import { recordCursorTurnUsage, type TurnUsage } from './record-turn-usage.js';
import { cursorSdkStateRoot, cursorWorkspaceRef } from './session-paths.js';
import {
  cursorSilentEndStatusText,
  cursorTerminalStatusSurfacing,
  cursorUsageLimit,
} from './turn-error.ts';

const CURSOR_CHEAP_MODEL_ID = 'composer-2-fast';
const SYSTEM_PROMPT_RULE_FILENAME = 'system-prompt.mdc';
const TERMINAL_STATUSES = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);

let completeTextScratchStorePromise: Promise<SqliteLocalAgentStore> | null = null;
function getCompleteTextScratchStore(): Promise<SqliteLocalAgentStore> {
  if (!completeTextScratchStorePromise) {
    const scratchDir = join('/tmp', `baguette-cursor-meta-${process.pid}`);
    completeTextScratchStorePromise = SqliteLocalAgentStore.open({
      workspaceRef: 'baguette-metadata',
      stateRoot: scratchDir,
    });
  }
  return completeTextScratchStorePromise;
}

const sessionStores = new Map<number, SqliteLocalAgentStore>();

async function openSessionStore(session: AgentSessionRow): Promise<SqliteLocalAgentStore> {
  if (session.id != null) {
    const cached = sessionStores.get(session.id);
    if (cached) return cached;
  }
  const store = await SqliteLocalAgentStore.open({
    workspaceRef: cursorWorkspaceRef(session),
    stateRoot: cursorSdkStateRoot(session) ?? join(DATA_DIR, 'cursor-sdk-store'),
  });
  if (session.id != null) sessionStores.set(session.id, store);
  return store;
}

function unwrapCursorResult(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw as { status?: unknown }).status === 'success' &&
    (raw as { value?: unknown }).value !== undefined
  ) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function taskToolArgsBackgrounded(args: unknown): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const a = args as Record<string, unknown>;
  return a.run_in_background === true || a.runInBackground === true;
}

function indicatesBackgroundWork(sdkMsg: SDKMessage): boolean {
  if (sdkMsg.type === 'task') return true;
  if (sdkMsg.type !== 'tool_call') return false;
  const name = sdkMsg.name;
  if (name !== 'Task' && name !== 'task') return false;
  return taskToolArgsBackgrounded(sdkMsg.args);
}

function parseModelParams(modelParams: unknown): ModelParameterValue[] | null {
  if (!modelParams) return null;
  if (typeof modelParams !== 'string') return modelParams as ModelParameterValue[];
  try {
    return JSON.parse(modelParams) as ModelParameterValue[];
  } catch {
    return null;
  }
}

async function writeAlwaysApplyRule(
  rulesRoot: string,
  { description, body }: { description: string; body: string }
): Promise<string> {
  const rulesDir = join(rulesRoot, '.cursor', 'rules');
  await mkdir(rulesDir, { recursive: true });
  await writeFile(
    join(rulesDir, SYSTEM_PROMPT_RULE_FILENAME),
    `---\ndescription: ${description}\nalwaysApply: true\n---\n\n${body}`,
    'utf8'
  );
  return rulesRoot;
}

async function getPluginRuleDirs(app: AgentApp, session: AgentSessionRow): Promise<string[]> {
  if (!session.plugins) return [];
  try {
    const pluginIds = JSON.parse(session.plugins);
    if (!Array.isArray(pluginIds) || !pluginIds.length) return [];
    const db = app.get('db') as (t: string) => {
      whereIn: (c: string, v: unknown[]) => Promise<Array<{ local_path?: string }>>;
    };
    const rows = await db('plugins').whereIn('id', pluginIds);
    const dirs: string[] = [];
    for (const row of rows) {
      if (!row?.local_path) continue;
      try {
        const s = await stat(join(row.local_path, '.cursor', 'rules'));
        if (s.isDirectory()) dirs.push(row.local_path);
      } catch {
        // plugin has no .cursor/rules dir
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

function mapCursorSdkMsgToAcp(sessionId: string, sdkMsg: SDKMessage): SessionNotification[] {
  switch (sdkMsg.type) {
    case 'assistant': {
      const out: SessionNotification[] = [];
      for (const block of sdkMsg.message.content) {
        if (block.type === 'text' && block.text) {
          out.push({
            sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: block.text },
            },
          });
        }
      }
      return out;
    }
    case 'thinking': {
      if (!sdkMsg.text) return [];
      return [
        {
          sessionId,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: sdkMsg.text },
          },
        },
      ];
    }
    case 'tool_call': {
      const msg = sdkMsg as SDKToolUseMessage;
      const input =
        msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args)
          ? (msg.args as Record<string, unknown>)
          : {};
      if (msg.status === 'running') {
        return [
          {
            sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: msg.call_id,
              title: msg.name,
              name: msg.name,
              status: 'in_progress',
              rawInput: input,
            },
          },
        ];
      }
      return [
        {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: msg.call_id,
            name: msg.name,
            rawInput: input,
            rawOutput: unwrapCursorResult(msg.result),
            status: msg.status === 'error' ? 'failed' : 'completed',
          },
        },
      ];
    }
    default:
      return [];
  }
}

export class CursorDriver implements AgentDriver {
  private readonly app: AgentApp;
  private readonly config: Record<string, unknown> | null;
  private readonly listeners = new Set<(notification: SessionNotification) => void>();
  private ctx: DriverContext | null = null;
  private sdkAgent: SDKAgent | null = null;
  private currentRun: Run | null = null;
  private stopRequested = false;
  private store: SqliteLocalAgentStore | null = null;
  private cwd = '';

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

  async start(ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.cwd =
      agentWorktreeCwd(ctx.session, ctx.agent) ||
      resolveDataDirRelativePath(ctx.session.session_path) ||
      ctx.cwd;
    this.store = await openSessionStore(ctx.session);
  }

  private async buildAgentOptions(params: DriverNewSessionParams): Promise<AgentOptions> {
    if (!this.ctx || !this.store) throw new Error('CursorDriver not started');
    const { session, channel, turnAgentConfigId } = this.ctx;
    const apiKey =
      typeof this.config?.api_key === 'string' && this.config.api_key.trim()
        ? this.config.api_key.trim()
        : undefined;

    const dirs: string[] = [];
    if (params.systemPromptAppend) {
      const absCwd = resolveDataDirRelativePath(session.session_path);
      if (absCwd) {
        const cursorDir = join(
          dirname(absCwd),
          'cursor-dir',
          channel === 'review' ? 'review' : 'build'
        );
        await writeAlwaysApplyRule(cursorDir, {
          description:
            channel === 'review'
              ? 'Baguette reviewer instructions'
              : 'Baguette session instructions',
          body: params.systemPromptAppend,
        });
        dirs.push(cursorDir);
      }
    }
    const pluginDirs = await getPluginRuleDirs(this.app, session);
    dirs.push(...pluginDirs);

    const customTools = toolListToCursorCustomTools(params.tools ?? this.ctx.baguetteTools ?? []);

    const agentOptions = {
      apiKey,
      local: {
        cwd: this.cwd,
        store: this.store,
        settingSources: (channel === 'review' ? [] : ['project']) as unknown as SettingSource[],
        dirs,
        customTools: customTools as unknown as Record<string, never>,
      },
    } as AgentOptions;

    if (params.model) {
      let modelParams = parseModelParams(params.modelParams);
      if (session.repo_id) {
        try {
          const user = await this.app.service('users').get(session.user_id, {});
          const userRepos = await this.app.service('user-repos').find({
            query: { repo_id: session.repo_id },
            user: { id: session.user_id },
            paginate: false,
          });
          const repo = userRepos?.[0] ?? null;
          if (repo) {
            const models = await loadModelsForSdk(user, 'cursor', repo, this.app, {
              agentConfigId: turnAgentConfigId,
            });
            const prefs = parseCursorModelPrefsJson(user.agent_preferences);
            modelParams = resolveCursorAgentModelParams({
              models,
              modelId: params.model,
              modelParams: (modelParams ?? params.modelParams) as
                string | ModelParameterValue[] | null | undefined,
              cursorModelPrefs: prefs,
            });
          }
        } catch (err) {
          logger.warn(
            { sessionId: session.id, modelId: params.model, err: (err as Error).message },
            'cursor-agent: could not resolve model params from registry'
          );
        }
      }
      agentOptions.model = modelParams?.length
        ? { id: params.model, params: modelParams }
        : { id: params.model };
    }

    if (this.ctx.userMcpServers && Object.keys(this.ctx.userMcpServers).length > 0) {
      agentOptions.mcpServers = this.ctx.userMcpServers as AgentOptions['mcpServers'];
    }
    return agentOptions;
  }

  async newSession(params: DriverNewSessionParams): Promise<DriverSessionResult> {
    const agentOptions = await this.buildAgentOptions(params);
    this.sdkAgent = await Agent.create(agentOptions);
    return {
      sessionId: this.sdkAgent.agentId,
      storedSessionId: this.sdkAgent.agentId,
    };
  }

  async resume(
    storedSessionId: string,
    params: DriverNewSessionParams
  ): Promise<DriverSessionResult> {
    const agentOptions = await this.buildAgentOptions(params);
    try {
      this.sdkAgent = await Agent.resume(storedSessionId, agentOptions);
      return {
        sessionId: this.sdkAgent.agentId,
        storedSessionId: this.sdkAgent.agentId,
      };
    } catch {
      return this.newSession(params);
    }
  }

  private async sendWithBusyRetry(userText: string): Promise<Run> {
    if (!this.sdkAgent || !this.store) throw new Error('CursorDriver session not opened');
    try {
      return await this.sdkAgent.send(userText);
    } catch (err) {
      const isActiveRunError =
        err instanceof AgentBusyError ||
        (err as Error)?.message?.includes('already has active run');
      if (!isActiveRunError) throw err;
      const { items } = await Agent.listRuns(this.sdkAgent.agentId, {
        cwd: this.cwd,
        store: this.store,
      });
      const stale = items.find((r) => r.status === 'running');
      if (stale) await stale.cancel();
      return this.sdkAgent.send(userText);
    }
  }

  private async runFailureDetail(run: Run): Promise<string | null> {
    if (run.error?.message) return run.error.message;
    if (run.supports && !run.supports('wait')) return null;
    if (typeof run.wait !== 'function') return null;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));
    try {
      const result = (await Promise.race([run.wait(), timeout])) as RunResult | null;
      if (!result || result.status !== 'error') return null;
      return result.error?.message || null;
    } catch (err) {
      if (err instanceof UnsupportedRunOperationError) return null;
      if ((err as Error).name === 'AbortError') return null;
      return (err as Error).message || null;
    }
  }

  private async streamOneRun(
    sessionId: string,
    run: Run,
    turnUsage: TurnUsage,
    signal?: AbortSignal
  ): Promise<{
    finishedOk: boolean;
    hasBackgroundTask: boolean;
    errorMessage?: string | null;
    usageLimitHit?: boolean;
  }> {
    let finishedOk = false;
    let hasBackgroundTask = false;
    let sawTerminalBreak = false;
    let errorMessage: string | null = null;
    let usageLimitHit = false;

    for await (const sdkMsg of run.stream()) {
      if (signal?.aborted) break;
      await this.ctx?.appendRawEvent?.(sdkMsg);
      if (indicatesBackgroundWork(sdkMsg)) hasBackgroundTask = true;
      if (sdkMsg.type === 'usage') {
        addTokenUsage(turnUsage, sdkMsg.usage);
        turnUsage.model = run.model?.id ?? this.ctx?.turnModel.model ?? turnUsage.model;
      }

      for (const n of mapCursorSdkMsgToAcp(sessionId, sdkMsg)) {
        this.emit(n);
      }

      if (sdkMsg.type === 'status') {
        const st = (sdkMsg as SDKStatusMessage).status;
        if (st === 'FINISHED') {
          sawTerminalBreak = true;
          finishedOk = true;
          break;
        }
        if (st === 'ERROR' || st === 'CANCELLED' || st === 'EXPIRED') {
          sawTerminalBreak = true;
          const userStopped = this.stopRequested || Boolean(signal?.aborted);
          const sdkDetail = (sdkMsg as SDKStatusMessage).message || null;
          const detail = userStopped || sdkDetail ? sdkDetail : await this.runFailureDetail(run);
          const surfacing = cursorTerminalStatusSurfacing(st, {
            detail,
            userInitiated: userStopped,
          });
          if (surfacing.usageLimit && this.ctx?.channel !== 'review') {
            usageLimitHit = true;
            await this.app
              .service('sessions')
              .onUsageLimit(this.ctx!.session.id, this.ctx!.agent.id, {
                label: 'Cursor',
                sdk: 'cursor',
                reason: 'rejected',
                reset_at_ms: surfacing.usageLimit.resetAtMs,
              });
          } else {
            errorMessage = surfacing.statusText;
          }
          break;
        }
      }
    }

    if (!finishedOk && !sawTerminalBreak && !this.stopRequested && !signal?.aborted) {
      const detail = await this.runFailureDetail(run);
      const limit = cursorUsageLimit(detail);
      if (limit && this.ctx?.channel !== 'review') {
        usageLimitHit = true;
        await this.app.service('sessions').onUsageLimit(this.ctx!.session.id, this.ctx!.agent.id, {
          label: 'Cursor',
          sdk: 'cursor',
          reason: 'rejected',
          reset_at_ms: limit.resetAtMs,
        });
      } else {
        errorMessage = cursorSilentEndStatusText(detail);
      }
    }

    return { finishedOk, hasBackgroundTask, errorMessage, usageLimitHit };
  }

  async prompt(
    sessionId: string,
    content: string,
    opts?: { signal?: AbortSignal }
  ): Promise<DriverPromptResult> {
    if (!this.sdkAgent || !this.store) throw new Error('CursorDriver session not opened');
    const turnUsage = emptyTurnUsage() as TurnUsage;
    const firstRun = await this.sendWithBusyRetry(content);
    this.currentRun = firstRun;

    const first = await this.streamOneRun(sessionId, firstRun, turnUsage, opts?.signal);
    if (first.usageLimitHit || this.stopRequested || opts?.signal?.aborted) {
      return { stopReason: 'aborted', usage: turnUsage };
    }
    if (!first.finishedOk) {
      return {
        stopReason: 'error',
        usage: turnUsage,
        errorMessage: first.errorMessage ?? 'Cursor turn failed',
      };
    }

    let hasBg = first.hasBackgroundTask;
    let lastCompletedId = firstRun.id;
    for (let i = 0; hasBg && i < 10; i++) {
      let followUp: Run | null = null;
      for (let poll = 0; poll < 30; poll++) {
        if (poll > 0) await new Promise((r) => setTimeout(r, 2000));
        if (this.stopRequested || opts?.signal?.aborted) break;
        const { items } = await Agent.listRuns(this.sdkAgent.agentId, {
          cwd: this.cwd,
          store: this.store,
        });
        const idx = items.findIndex((r) => r.id === lastCompletedId);
        const candidate = idx >= 0 ? items[idx + 1] : items.find((r) => r.status === 'running');
        if (candidate && candidate.id !== lastCompletedId) {
          followUp = candidate;
          break;
        }
      }
      if (!followUp) break;
      this.currentRun = followUp;
      const next = await this.streamOneRun(sessionId, followUp, turnUsage, opts?.signal);
      if (next.usageLimitHit || this.stopRequested || opts?.signal?.aborted) {
        return { stopReason: 'aborted', usage: turnUsage };
      }
      if (!next.finishedOk) {
        return {
          stopReason: 'error',
          usage: turnUsage,
          errorMessage: next.errorMessage ?? 'Cursor follow-up run failed',
        };
      }
      lastCompletedId = followUp.id;
      hasBg = next.hasBackgroundTask;
    }

    return { stopReason: 'end_turn', usage: turnUsage };
  }

  async steer(_sessionId: string, content: string, row: MessageRowLike): Promise<boolean> {
    if (!row.force || !this.currentRun?.steer) return false;
    await this.currentRun.steer(content).catch(() => {});
    return true;
  }

  async cancel(_sessionId: string): Promise<void> {
    this.stopRequested = true;
    await this.currentRun?.cancel().catch(() => {});
  }

  async close(): Promise<void> {
    this.currentRun = null;
    this.sdkAgent = null;
  }

  async recordTurnUsage(opts: DriverRecordUsageOpts): Promise<void> {
    await recordCursorTurnUsage(this.app, opts.session, opts.usage as TurnUsage, {
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
    const apiKey =
      typeof this.config?.api_key === 'string' && this.config.api_key.trim()
        ? this.config.api_key.trim()
        : undefined;
    const modelId = params.model || CURSOR_CHEAP_MODEL_ID;
    const store = await getCompleteTextScratchStore();
    const agent = await Agent.create({
      apiKey,
      model: { id: modelId },
      local: { settingSources: [], store },
    } as AgentOptions);
    const run = await agent.send(params.prompt);
    let collected = '';
    for await (const sdkMsg of run.stream()) {
      if (params.signal.aborted) break;
      if (sdkMsg.type === 'assistant') {
        const content = (
          sdkMsg as { message?: { content?: Array<{ type?: string; text?: string }> } }
        ).message?.content;
        for (const block of content ?? []) {
          if (block.type === 'text') collected += block.text ?? '';
        }
      }
      if (
        sdkMsg.type === 'status' &&
        TERMINAL_STATUSES.has(String((sdkMsg as { status?: string }).status ?? ''))
      ) {
        break;
      }
    }
    return collected.trim();
  }
}
