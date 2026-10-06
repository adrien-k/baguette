import { Agent, AgentBusyError } from '@cursor/sdk';
import type {
  AgentOptions,
  ModelParameterValue,
  Run,
  SDKAgent,
  SDKCustomTool,
  SettingSource,
} from '@cursor/sdk';
import { SqliteLocalAgentStore } from '@cursor/sdk/sqlite';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import logger from '../../logger.js';
import { resolveDataDirRelativePath, DATA_DIR } from '../../config.js';
import { buildCursorCustomTools } from '../baguette-mcp-server.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { getEffectiveAgentPrompt } from '../effective-user-prompts.js';
import { applyCursorUsageDerivation } from '../../../shared/cursor-token-adjustment.js';
import { addTokenUsage, emptyTurnUsage } from '../turn-usage.js';
import { processCursorRunStream } from '../cursor-sdk-turn.js';
import { expandUserContentForAgent } from '../../../shared/user-message-content.js';
import {
  isHumanUserMessage as isHumanUserMessageShared,
  resolveTurnModel,
} from '../../../shared/turn-model.js';
import { estimateCursorUsageCostUsd } from '../../lib/cursor-usage-row-cost.js';
import { attachAppErrorHandler, handleAppError } from '../../lib/app-error-handler.js';
import { loadModelsForSdk } from '../baguette-models-for-user.js';
import { parseCursorModelPrefsJson } from '../agent-preferences.js';
import { resolveCursorAgentModelParams } from '../cursor-model-params.js';
import { reviewTurnKey } from './session-review.service.js';
import {
  isDispatchableUserMessage,
  parseUserRow,
  rejectTurnMismatch,
} from '../agent-message-dispatch.js';
import { createMessageStreamWriter } from '../message-writer-factory.ts';
import type { MessageStreamWriter } from '../../../shared/message-stream-writer.ts';
import type { SystemMessagePayload } from '../../../shared/session-messages.ts';
import type {
  AgentApp,
  AgentSessionRow,
  ChatTable,
  DbLike,
  MessageChannel,
  MessageRowLike,
  QueryBuilderLike,
} from './agent-service-types.ts';

const CURSOR_CHEAP_MODEL_ID = 'claude-haiku-4-5';

const SYSTEM_PROMPT_RULE_FILENAME = 'system-prompt.mdc';
const PROMPT_RULE_MODES = ['build', 'review'];

/** Per-turn token usage accumulator (see turn-usage.js). */
type TurnUsage = Omit<ReturnType<typeof emptyTurnUsage>, 'model'> & {
  model?: string | null;
  raw_token_usage?: unknown;
};

/** Active Cursor run state for a session/chat key. */
type CursorSessionState = {
  isProcessing: boolean;
  userId: number;
  currentRun: Run | null;
  abortController?: AbortController;
  writer?: MessageStreamWriter | null;
  turnId?: number | null;
  channel?: MessageChannel;
};

type StreamOneRunOpts = {
  activeKey?: string | number;
  channel?: MessageChannel;
  writer?: MessageStreamWriter | null;
};

type StreamOneRunResult = { finishedOk: boolean; hasBackgroundTask: boolean };

function extractUserText(parsed: unknown): string {
  const p = parsed as {
    content?: unknown;
    message?: { content?: unknown };
  };
  if (typeof p.content === 'string') return p.content;
  const content = p.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return expandUserContentForAgent(content);
  return '';
}

export class CursorAgentService {
  app!: AgentApp;
  private _activeSessions: Map<string | number, CursorSessionState>;

  constructor() {
    this._activeSessions = new Map();
  }

  setup(app: AgentApp) {
    this.app = app;
  }

  async writeAlwaysApplyRule(
    rulesRoot: string,
    {
      filename = SYSTEM_PROMPT_RULE_FILENAME,
      description,
      body,
    }: { filename?: string; description: string; body: string }
  ): Promise<string> {
    const rulesDir = join(rulesRoot, '.cursor', 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(
      join(rulesDir, filename),
      `---
description: ${description}
alwaysApply: true
---

${body}`,
      'utf8'
    );
    return rulesRoot;
  }

  cursorDirForSession(session: AgentSessionRow): string | null {
    const absoluteCwd = resolveDataDirRelativePath(session.worktree_path);
    if (!absoluteCwd) return null;
    return join(dirname(absoluteCwd), 'cursor-dir');
  }

  async writePromptRule(
    session: AgentSessionRow,
    mode: string,
    { description, body }: { description: string; body: string }
  ): Promise<string | null> {
    if (!PROMPT_RULE_MODES.includes(mode)) {
      throw new Error(`Unknown cursor prompt mode: ${mode}`);
    }
    const cursorDir = this.cursorDirForSession(session);
    if (!cursorDir) return null;
    const rulesRoot = join(cursorDir, mode);
    await this.writeAlwaysApplyRule(rulesRoot, { description, body });
    return rulesRoot;
  }

  async resolveApiKey(session: AgentSessionRow): Promise<string | undefined> {
    const user = await this.app.service('users').get(session.user_id, {});
    let repoApiKey: string | null = null;
    if (session.repo_id) {
      const userRepos = await this.app.service('user-repos').find({
        query: { repo_id: session.repo_id },
        user: { id: session.user_id },
        paginate: false,
      });
      repoApiKey = userRepos?.[0]?.cursor_api_key || null;
    }
    return repoApiKey || user.cursor_api_key || undefined;
  }

  parseModelParams(modelParams: unknown): ModelParameterValue[] | null {
    if (!modelParams) return null;
    if (typeof modelParams !== 'string') return modelParams as ModelParameterValue[];
    try {
      return JSON.parse(modelParams) as ModelParameterValue[];
    } catch {
      return null;
    }
  }

  async buildAgentOptions(
    session: AgentSessionRow,
    {
      customTools,
      settingSources = ['project'],
      dirs,
      model,
      modelParams,
      apiKey,
    }: {
      customTools?: unknown;
      settingSources?: string[];
      dirs?: string[];
      model?: string | null;
      modelParams?: unknown;
      apiKey?: string | undefined;
    } = {}
  ): Promise<AgentOptions> {
    const cwd = resolveDataDirRelativePath(session.worktree_path) || '';
    const resolvedApiKey = apiKey !== undefined ? apiKey : await this.resolveApiKey(session);
    const resolvedTools = customTools ?? (await buildCursorCustomTools(session, this.app));
    const agentOptions = {
      apiKey: resolvedApiKey,
      local: {
        cwd,
        settingSources: settingSources as unknown as SettingSource[],
        dirs: dirs ?? [],
        customTools: resolvedTools as unknown as Record<string, SDKCustomTool>,
        stateRoot: join(DATA_DIR, 'cursor-sdk-store'),
      },
    } as AgentOptions;
    const modelId = model ?? null;
    if (modelId) {
      let params = this.parseModelParams(modelParams);
      try {
        const user = await this.app.service('users').get(session.user_id, {});
        let repo: Record<string, unknown> | null = null;
        if (session.repo_id) {
          const userRepos = await this.app.service('user-repos').find({
            query: { repo_id: session.repo_id },
            user: { id: session.user_id },
            paginate: false,
          });
          repo = userRepos?.[0] ?? null;
        }
        const models = await loadModelsForSdk(user, 'cursor', repo);
        const prefs = parseCursorModelPrefsJson(user.agent_preferences);
        params = resolveCursorAgentModelParams({
          models,
          modelId,
          modelParams: (params ?? modelParams) as string | ModelParameterValue[] | null | undefined,
          cursorModelPrefs: prefs,
        });
      } catch (err) {
        logger.warn(
          { sessionId: session.id, modelId, err: (err as Error).message },
          'cursor-agent: could not resolve model params from registry'
        );
      }
      agentOptions.model = params?.length ? { id: modelId, params } : { id: modelId };
    }
    return agentOptions;
  }

  async handleTableMessageCreated(row: MessageRowLike, table: ChatTable) {
    if (row.type !== 'user') return;

    const parsed = parseUserRow(row);
    if (!parsed || !isDispatchableUserMessage(parsed)) return;

    const sessionId = row.session_id;
    const session = (await (this.app.get('db') as DbLike)('sessions')
      .where({ id: sessionId })
      .first()) as AgentSessionRow | undefined;
    if (!session || session.archived_at) return;

    const channel: MessageChannel = table === 'session-review-messages' ? 'review' : 'chat';
    const sdk = channel === 'review' ? session.review_agent_sdk : session.agent_sdk;
    if (sdk !== 'cursor') return;

    if (channel === 'chat') {
      if (session.status === 'archiving' || session.status === 'archived') return;
      if (session.repo_full_name && !session.worktree_path) return;
    }

    const activeKey = channel === 'review' ? reviewTurnKey(sessionId) : sessionId;
    const active = this._activeSessions.get(activeKey);
    const activeTurnId =
      channel === 'review' ? session.active_review_turn_id : session.active_chat_turn_id;

    if (active?.isProcessing) {
      if (row.turn_id != null && activeTurnId != null && row.turn_id !== activeTurnId) {
        await rejectTurnMismatch(this.app, {
          session,
          row,
          channel,
          activeTurnId,
          userId: session.user_id,
        });
        return;
      }
      if (row.force && active.currentRun?.steer && isHumanUserMessageShared(parsed)) {
        const text = extractUserText(parsed);
        if (text) active.currentRun.steer(text).catch(() => {});
      }
      return;
    }

    const turnModel = resolveTurnModel(row, session);
    const meta = { turnId: row.turn_id as number | null, channel, activeKey };
    attachAppErrorHandler(this.app, this._runTurn(session, parsed, turnModel, meta), {
      userId: session.user_id,
      sessionId: session.id,
    }).catch((err) => {
      logger.error({ sessionId, err: (err as Error).message }, 'cursor-agent turn failed');
    });
  }

  /** @deprecated use handleTableMessageCreated */
  async onMessageCreated(message: MessageRowLike) {
    return this.handleTableMessageCreated(message, 'messages');
  }

  async _prepareGlobalRulesDir(session: AgentSessionRow): Promise<string | null> {
    if (!session.worktree_path) return null;
    const absoluteCwd = resolveDataDirRelativePath(session.worktree_path);
    const agentPrompt = await getEffectiveAgentPrompt(this.app, session.user_id, session.repo_id);
    const systemPrompt = await buildSystemPromptAppend(
      {
        ...session,
        absolute_worktree_path: absoluteCwd,
      },
      { agentPrompt }
    );
    return this.writePromptRule(session, 'build', {
      description: 'Baguette session rules (always applied)',
      body: systemPrompt,
    });
  }

  async _getPluginDirs(session: AgentSessionRow): Promise<string[]> {
    if (!session.plugins) return [];
    try {
      const pluginIds: unknown = JSON.parse(session.plugins);
      if (!Array.isArray(pluginIds) || pluginIds.length === 0) return [];
      const pluginRows = await (this.app.get('db') as DbLike)('plugins').whereIn('id', pluginIds);
      const dirs: string[] = [];
      for (const p of pluginRows) {
        const pluginRoot = resolveDataDirRelativePath(p.local_path as string) ?? '';
        try {
          await access(join(pluginRoot, '.cursor', 'rules'));
          dirs.push(pluginRoot);
        } catch {
          // plugin has no .cursor/rules/, skip
        }
      }
      return dirs;
    } catch {
      return [];
    }
  }

  async createOrResumeAgent(
    session: AgentSessionRow,
    {
      agentOptions,
      resumeAgentId,
      persistAgentId,
    }: {
      agentOptions: AgentOptions;
      resumeAgentId?: string | null;
      persistAgentId?: (agentId: string) => Promise<unknown> | unknown;
    }
  ): Promise<SDKAgent> {
    const sessionId = session.id;
    let agent: SDKAgent | undefined;
    if (resumeAgentId) {
      logger.info(
        { sessionId, storedAgentId: resumeAgentId },
        'cursor-agent: resuming stored agent'
      );
      try {
        agent = await Agent.resume(resumeAgentId, agentOptions);
      } catch (err) {
        logger.warn(
          { sessionId, storedAgentId: resumeAgentId, err: (err as Error).message },
          'cursor-agent: resume failed, will create fresh agent'
        );
      }
    }
    if (!agent) {
      logger.info({ sessionId }, 'cursor-agent: creating new agent');
      agent = await Agent.create(agentOptions);
      await persistAgentId?.(agent.agentId);
    }
    return agent;
  }

  async _sessionAgentOptions(
    session: AgentSessionRow,
    turnModel: { model?: string | null; modelParams?: unknown } = {}
  ) {
    const user = await this.app.service('users').get(session.user_id, {});
    const baguetteRulesDir = await this._prepareGlobalRulesDir(session);
    const pluginDirs = await this._getPluginDirs(session);
    return this.buildAgentOptions(session, {
      dirs: [baguetteRulesDir, ...pluginDirs].filter((d): d is string => Boolean(d)),
      model: turnModel.model ?? session.model ?? user.cursor_model ?? null,
      modelParams: turnModel.modelParams ?? session.model_params,
    });
  }

  async _sendWithBusyRetry(
    agent: SDKAgent,
    session: AgentSessionRow,
    userText: string,
    sendOptions: Record<string, unknown> = {}
  ): Promise<Run> {
    try {
      return await agent.send(userText, sendOptions as never);
    } catch (err) {
      const isActiveRunError =
        err instanceof AgentBusyError ||
        (err as Error)?.message?.includes('already has active run');
      if (!isActiveRunError) throw err;
      const cwd = resolveDataDirRelativePath(session.worktree_path) || '';
      const { items } = await Agent.listRuns(agent.agentId, { cwd });
      const stale = items.find((r) => r.status === 'running');
      if (stale) await stale.cancel();
      return agent.send(userText, sendOptions as never);
    }
  }

  /**
   * Create/resume a Cursor agent, send one prompt, and stream until the run ends.
   * Session chat adds follow-up runs and usage on top; review uses this directly.
   */
  async runTurn({
    session,
    userText,
    agentOptions,
    writer,
    resumeAgentId,
    persistAgentId,
    persistStatus,
    onStatus,
    onUsage,
    sendOptions = {},
    activeKey,
    abortController,
  }: {
    session: AgentSessionRow;
    userText: string;
    agentOptions: AgentOptions;
    /** Stream writer used to persist typed messages for this turn. */
    writer: MessageStreamWriter;
    resumeAgentId?: string | null;
    persistAgentId?: (agentId: string) => Promise<unknown> | unknown;
    persistStatus?: (text: string) => Promise<void>;
    onStatus?: (sdkMsg: unknown) => Promise<{ break: boolean; finishedOk?: boolean } | void>;
    onUsage?: (sdkMsg: unknown) => void;
    sendOptions?: Record<string, unknown>;
    activeKey?: string | number;
    abortController?: AbortController;
  }): Promise<{ outcome: 'completed' | 'failed' | 'stopped'; agent?: SDKAgent; run?: Run }> {
    const key = activeKey ?? session.id;
    const controller = abortController ?? new AbortController();
    const sessionState: CursorSessionState = {
      isProcessing: true,
      userId: session.user_id,
      currentRun: null,
      abortController: controller,
    };
    this._activeSessions.set(key, sessionState);
    let outcome: 'completed' | 'failed' | 'stopped' = 'failed';
    try {
      const agent = await this.createOrResumeAgent(session, {
        agentOptions,
        resumeAgentId,
        persistAgentId,
      });
      const run = await this._sendWithBusyRetry(agent, session, userText, sendOptions);
      sessionState.currentRun = run;
      const { finishedOk } = await processCursorRunStream(run, {
        writer,
        onUsage,
        onStatus,
        abortSignal: controller.signal,
      });
      outcome = finishedOk ? 'completed' : 'failed';
      return { outcome, agent, run };
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        logger.error(
          { sessionId: session.id, err: (err as Error).message },
          'Cursor session stream error'
        );
        try {
          await persistStatus?.((err as Error).message);
        } catch {
          // ignore secondary errors
        }
        this.app.service('sessions').emit('app:error', {
          sessionId: session.id,
          message: (err as Error).message,
          user_id: session.user_id,
        });
        outcome = 'failed';
      } else {
        outcome = 'stopped';
      }
      return { outcome };
    } finally {
      this._activeSessions.delete(key);
    }
  }

  async stopTurn(activeKey: string | number): Promise<void> {
    const session = this._activeSessions.get(activeKey);
    if (!session) return;
    try {
      session.abortController?.abort();
      await session.currentRun?.cancel();
    } catch {
      // ignore cancellation errors
    }
    this._activeSessions.delete(activeKey);
  }

  async _runTurn(
    session: AgentSessionRow,
    parsed: unknown,
    turnModel: { model?: string | null; modelParams?: unknown } = {},
    meta: { turnId?: number | null; channel?: MessageChannel; activeKey?: string | number } = {}
  ): Promise<void> {
    const sessionId = session.id;
    const userId = session.user_id;
    const channel: MessageChannel = meta.channel ?? 'chat';
    const activeKey = meta.activeKey ?? sessionId;
    const turnId = meta.turnId ?? null;
    let turnFinishedOk = false;

    const db = this.app.get('db') as DbLike;
    if (turnId != null) {
      const activeField =
        channel === 'review' ? { active_review_turn_id: turnId } : { active_chat_turn_id: turnId };
      await db('sessions').where({ id: sessionId }).update(activeField);
    }

    const writer =
      turnId != null
        ? createMessageStreamWriter(this.app, {
            sessionId,
            userId,
            turnId,
            channel,
            worktreePath: session.worktree_path,
          })
        : null;

    const sessionState: CursorSessionState = {
      isProcessing: true,
      userId,
      currentRun: null,
      writer,
      turnId,
      channel,
    };
    this._activeSessions.set(activeKey, sessionState);
    const turnUsage = emptyTurnUsage() as TurnUsage;
    try {
      if (channel !== 'review') {
        await this.app
          .service('sessions')
          .patch(sessionId, { status: 'running' }, { user: { id: userId } });
        await this.app.service('sessions').onTurnStart(sessionId);
      }
      const resumeAgentId =
        channel === 'review' ? session.review_cursor_agent_id : session.cursor_agent_id;
      const reviewExtras =
        channel === 'review'
          ? (this.app.service('session-review').peekTurnExtras(sessionId) ?? {})
          : null;
      const agentOptions =
        channel === 'review'
          ? await this.app.service('session-review').buildCursorReviewAgentOptions(session, {
              model: turnModel.model,
              modelParams: turnModel.modelParams,
              continuation: !!resumeAgentId || Boolean(reviewExtras.continuation),
              extraPrompt: reviewExtras.extraPrompt,
            })
          : await this._sessionAgentOptions(session, turnModel);
      const agent = await this.createOrResumeAgent(session, {
        agentOptions,
        resumeAgentId,
        persistAgentId: (agentId) => {
          const field =
            channel === 'review'
              ? { review_cursor_agent_id: agentId }
              : { cursor_agent_id: agentId };
          return db('sessions').where({ id: sessionId }).update(field);
        },
      });
      const userText = extractUserText(parsed);
      const sendOptions: Record<string, unknown> = {};
      if (session.plan_mode) {
        sendOptions.mode = 'plan';
      }

      const run = await this._sendWithBusyRetry(agent, session, userText, sendOptions);
      sessionState.currentRun = run;

      const { finishedOk: mainFinished, hasBackgroundTask } = await this._streamOneRun(
        session,
        run,
        turnUsage,
        turnModel,
        { activeKey, channel, writer }
      );

      if (mainFinished) {
        let allDone = true;
        let lastCompletedRunId: string = run.id;

        // If a background task was spawned, poll for the agent-scheduled follow-up run.
        if (hasBackgroundTask) {
          const MAX_FOLLOW_UPS = 10;
          for (let i = 0; i < MAX_FOLLOW_UPS; i++) {
            const followUpRun = await this._findFollowUpRun(session, agent, lastCompletedRunId);
            if (!followUpRun) break;

            logger.info(
              { sessionId, followUpRunId: followUpRun.id, followUpIndex: i },
              'cursor-agent: processing follow-up run from background task'
            );
            sessionState.currentRun = followUpRun;
            const { finishedOk: followUpDone, hasBackgroundTask: moreFollowUps } =
              await this._streamOneRun(session, followUpRun, turnUsage, turnModel, {
                activeKey,
                channel,
                writer,
              });

            if (!followUpDone) {
              allDone = false;
              break;
            }
            lastCompletedRunId = followUpRun.id;
            if (!moreFollowUps) break;
          }
        }

        if (allDone) {
          turnFinishedOk = true;
          if (channel === 'review') {
            await this.app.service('session-review').onAgentTurnComplete(session, 'completed', {
              sdk: 'cursor',
              turnUsage,
              agent,
              turnModel,
            });
          } else {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'completed' }, { user: { id: userId } });
          }
        }
      }

      if (turnFinishedOk && channel !== 'review') {
        await this._recordTurnUsage(session, agent, turnUsage, { turnModel }).catch((err) =>
          logger.warn(
            { sessionId, err: (err as Error).message },
            'cursor-agent: failed to record turn usage'
          )
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handleAppError(this.app, err, { userId, sessionId });
        logger.error({ sessionId, err: (err as Error).message }, 'Cursor session stream error');
        try {
          if (channel === 'review') {
            await this.app.service('session-review').onAgentTurnComplete(session, 'failed', {
              sdk: 'cursor',
            });
            await this.app
              .service('session-review')
              ._persistStatus(session, (err as Error).message);
          } else {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
            await this._persistStatusMessage(sessionId, userId, (err as Error).message);
          }
        } catch {
          // ignore secondary errors
        }
        this.app
          .service('sessions')
          .emit('app:error', { sessionId, message: (err as Error).message, user_id: userId });
      }
    } finally {
      const clearField =
        channel === 'review' ? { active_review_turn_id: null } : { active_chat_turn_id: null };
      await (db('sessions').where({ id: sessionId }).update(clearField) as QueryBuilderLike).catch(
        () => {}
      );
      this._activeSessions.delete(activeKey);
    }

    if (turnFinishedOk && channel !== 'review') {
      try {
        await this.app.service('sessions').onTurnComplete(sessionId);
      } catch (err) {
        logger.warn(
          { sessionId, err: (err as Error).message },
          'cursor-agent: failed to send queued message'
        );
      }
    }
  }

  /**
   * Stream one run to completion. Returns { finishedOk, hasBackgroundTask }.
   * Handles ERROR/CANCELLED/EXPIRED by patching session status to 'failed' and persisting a message.
   * FINISHED is left for the caller to handle (so follow-up runs can be chained first).
   */
  async _streamOneRun(
    session: AgentSessionRow,
    run: Run,
    turnUsage: TurnUsage = emptyTurnUsage() as TurnUsage,
    turnModel: { model?: string | null; modelParams?: unknown } = {},
    streamOpts: StreamOneRunOpts = {}
  ): Promise<StreamOneRunResult> {
    const sessionId = session.id;
    const userId = session.user_id;
    const channel: MessageChannel = streamOpts.channel ?? 'chat';
    const activeKey = streamOpts.activeKey ?? session.id;
    const sessionState = this._activeSessions.get(activeKey);
    const writer =
      streamOpts.writer ??
      sessionState?.writer ??
      createMessageStreamWriter(this.app, {
        sessionId,
        userId: session.user_id,
        turnId: sessionState?.turnId ?? 1,
        channel: sessionState?.channel ?? 'chat',
        worktreePath: session.worktree_path,
      });

    return processCursorRunStream(run, {
      writer,
      onUsage: (sdkMsg: { usage?: unknown }) => {
        addTokenUsage(turnUsage, sdkMsg.usage);
        turnUsage.model = run.model?.id ?? turnModel.model ?? session.model ?? turnUsage.model;
      },
      onStatus: async (sdkMsg: {
        status?: string;
        message?: string;
        agent_id?: string;
        run_id?: string;
      }) => {
        const { status } = sdkMsg;
        if (status === 'FINISHED') {
          return { break: true, finishedOk: true };
        }
        if (status === 'ERROR' || status === 'CANCELLED' || status === 'EXPIRED') {
          logger.warn(
            {
              sessionId,
              status,
              agent_id: sdkMsg.agent_id,
              run_id: sdkMsg.run_id,
              sdkMessage: sdkMsg.message,
            },
            'cursor-agent received terminal status'
          );
          let statusMsg: string;
          if (status === 'EXPIRED') {
            statusMsg =
              'Cursor agent conversation expired. Send your message again to continue in a fresh conversation.';
          } else if (status === 'CANCELLED') {
            statusMsg = 'Cursor agent was cancelled.';
          } else {
            statusMsg = `Cursor agent encountered an error.${sdkMsg.message ? ` ${sdkMsg.message}` : ''} Send your message again to continue in a fresh conversation.`;
          }
          if (channel === 'review') {
            await this.app.service('session-review')._persistStatus(session, statusMsg);
            await this.app.service('session-review').onAgentTurnComplete(session, 'failed', {
              sdk: 'cursor',
            });
          } else {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
            await this._persistStatusMessage(sessionId, userId, statusMsg);
          }
          return { break: true, finishedOk: false };
        }
      },
    });
  }

  /**
   * Polls Agent.listRuns for a follow-up run created by a background task.
   * Returns the run if found within the timeout, null otherwise.
   */
  async _findFollowUpRun(
    session: AgentSessionRow,
    agent: SDKAgent,
    completedRunId: string
  ): Promise<Run | null> {
    const cwd = resolveDataDirRelativePath(session.worktree_path) || '';
    const POLLS = 8;
    const DELAY_MS = 2000;

    for (let i = 0; i < POLLS; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      try {
        const { items } = await Agent.listRuns(agent.agentId, { cwd });
        const followUp = items.find((r) => r.status === 'running' && r.id !== completedRunId);
        if (followUp) return followUp;
      } catch (err) {
        logger.warn(
          { sessionId: session.id, err: (err as Error).message },
          'cursor-agent: error checking for follow-up run'
        );
        return null;
      }
    }
    return null;
  }

  /**
   * Record one `usage` row for the finished turn: token counts from the run stream
   * plus USD estimated from our pricing table (see shared/cursor-model-pricing.js).
   *
   * We do not call `agent.getUsage()` for cost. Baguette runs Cursor local agents;
   * their usage endpoint answers `feature_unavailable`, so billed USD is never
   * available there. Cloud agents could return cost, but we keep one code path:
   * token-derived estimates only.
   *
   * `kind: 'review'` tags reviewer usage separately from session-chat turns.
   */
  async recordTurnUsage(
    session: AgentSessionRow,
    agent: SDKAgent,
    turnUsage: TurnUsage,
    options: { kind?: string; turnModel?: { model?: string | null } } = {}
  ): Promise<void> {
    return this._recordTurnUsage(session, agent, turnUsage, options);
  }

  async _recordTurnUsage(
    session: AgentSessionRow,
    _agent: SDKAgent,
    turnUsage: TurnUsage,
    { kind, turnModel }: { kind?: string; turnModel?: { model?: string | null } } = {}
  ): Promise<void> {
    const db = this.app.get('db') as DbLike;
    const sessionId = session.id;
    const userId = session.user_id;

    applyCursorUsageDerivation(turnUsage);
    const deltaCostUsd = this._turnCostUsd(session, turnUsage, { kind, turnModel });

    // Nothing to say about this turn at all — don't write an empty row.
    if (deltaCostUsd <= 0 && turnUsage.total_tokens <= 0) return;

    await db('usage').insert({
      session_id: sessionId,
      user_id: userId,
      repo_full_name: session.repo_full_name,
      cost_usd: Math.max(deltaCostUsd, 0),
      agent_sdk: 'cursor',
      kind: kind ?? null,
      input_tokens: turnUsage.input_tokens,
      output_tokens: turnUsage.output_tokens,
      cache_read_tokens: turnUsage.cache_read_tokens,
      cache_write_tokens: turnUsage.cache_write_tokens,
      reasoning_tokens: turnUsage.reasoning_tokens,
      total_tokens: turnUsage.total_tokens,
      raw_token_usage: turnUsage.raw_token_usage,
      model:
        turnUsage.model ??
        turnModel?.model ??
        (kind === 'review' ? session.review_model : null) ??
        session.model ??
        null,
    });

    if (deltaCostUsd <= 0) return;

    const currentSession = await db('sessions')
      .where({ id: sessionId })
      .select('total_cost_usd')
      .first();
    const prevSessionCost = parseFloat(String(currentSession?.total_cost_usd ?? 0));
    await this.app
      .service('sessions')
      .patch(
        sessionId,
        { total_cost_usd: prevSessionCost + deltaCostUsd },
        { provider: undefined, user: { id: userId } }
      );
  }

  /** Per-turn USD from token counts when the model is in our pricing table; else 0. */
  _turnCostUsd(
    session: AgentSessionRow,
    turnUsage: TurnUsage,
    { kind, turnModel }: { kind?: string; turnModel?: { model?: string | null } } = {}
  ): number {
    return estimateCursorUsageCostUsd(turnUsage, session, { kind, turnModel });
  }

  async _persistMessage(sessionId: number, userId: number, message: Record<string, unknown>) {
    return await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: message.type,
        subtype: (message.subtype as string | undefined) ?? null,
        uuid: (message.uuid as string | undefined) ?? null,
        message_json: JSON.stringify(message),
        total_cost_usd: null,
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  async _persistStatusMessage(sessionId: number, userId: number, statusText: string) {
    const payload: SystemMessagePayload = { type: 'system', subtype: 'status', status: statusText };
    await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: 'system',
        subtype: 'status',
        message_json: JSON.stringify(payload),
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  async stopSession(sessionId: number) {
    await this.stopTurn(sessionId);
  }

  getActiveSession(sessionId: string | number): CursorSessionState | null {
    return this._activeSessions.get(sessionId) ?? null;
  }

  async get(id: number) {
    return this.getActiveSession(id);
  }

  async deleteAgent(session: AgentSessionRow | null | undefined): Promise<void> {
    if (!session?.cursor_agent_id) return;
    const sessionId = session.id;
    const cwd = resolveDataDirRelativePath(session.worktree_path) || DATA_DIR;
    const store = await SqliteLocalAgentStore.open({
      workspaceRef: cwd,
      stateRoot: join(DATA_DIR, 'cursor-sdk-store'),
    });
    try {
      await Agent.delete(session.cursor_agent_id, { store });
      logger.info(
        { sessionId, agentId: session.cursor_agent_id },
        'cursor-agent: deleted agent on archive'
      );
    } finally {
      await store.dispose().catch(() => {});
    }
  }

  async generateSessionMetadata(
    initialPrompt: string,
    shortId = '',
    user: { id?: number } | null = null,
    repo: { id?: number | null } | null = null
  ): Promise<{ label: string; branchName: string }> {
    const fallbackBranch = `task-${shortId}`;
    const prompt = `Generate metadata for a coding task. Output ONLY a JSON object with no markdown or explanation:
- "label": very short label (max 50 chars) summarizing the task
- "branch": short kebab-case git branch name suffixed with "-${shortId}" (e.g. "fix-auth-token-${shortId}"), max 60 chars

Task: ${initialPrompt}`;

    let label = '';
    let branchName = fallbackBranch;

    const fullUser = user?.id ? await this.app.service('users').get(user.id, {}) : null;

    let repoApiKey: string | null = null;
    if (repo?.id && user?.id) {
      const userRepos = await this.app.service('user-repos').find({
        query: { repo_id: repo.id },
        user: { id: user.id },
        paginate: false,
      });
      repoApiKey = userRepos?.[0]?.cursor_api_key || null;
    }

    const apiKey = repoApiKey || fullUser?.cursor_api_key || undefined;
    const agent = await Agent.create({
      apiKey,
      model: { id: CURSOR_CHEAP_MODEL_ID },
      local: { settingSources: [] },
    } as AgentOptions);

    const run = await agent.send(prompt);
    let collectedText = '';

    for await (const sdkMsg of run.stream()) {
      if (sdkMsg.type === 'assistant') {
        const content = (
          sdkMsg as { message?: { content?: Array<{ type?: string; text?: string }> } }
        ).message?.content;
        for (const block of content ?? []) {
          if (block.type === 'text') collectedText += block.text ?? '';
        }
      }
      if (
        sdkMsg.type === 'status' &&
        (sdkMsg as { status?: string }).status &&
        ['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'].includes(
          (sdkMsg as { status?: string }).status as string
        )
      ) {
        break;
      }
    }

    const text = collectedText.trim();
    if (text) {
      try {
        const jsonText = text
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '')
          .trim();
        const parsed = JSON.parse(jsonText) as { label?: string; branch?: string };
        label = (parsed.label || '').slice(0, 80);
        branchName = (parsed.branch || fallbackBranch)
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 60);
      } catch {
        label = text.slice(0, 80);
      }
    }

    return { label, branchName };
  }
}

export function registerCursorAgentService(app: AgentApp, path = 'cursor-agent') {
  const service = new CursorAgentService();
  service.setup(app);
  app.use(path, service, {
    methods: [
      'onMessageCreated',
      'handleTableMessageCreated',
      'stopSession',
      'stopTurn',
      'runTurn',
      'buildAgentOptions',
      'writeAlwaysApplyRule',
      'writePromptRule',
      'createOrResumeAgent',
      'generateSessionMetadata',
      'deleteAgent',
      'recordTurnUsage',
    ],
  });
}
