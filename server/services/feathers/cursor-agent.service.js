import { Agent, AgentBusyError } from '@cursor/sdk';
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
import { resolveTurnModel } from '../../../shared/turn-model.js';
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
import { createMessageStreamWriter } from '../message-writer-factory.js';
import { isHumanUserMessage as isHumanUserMessageShared } from '../../../shared/turn-model.js';

const CURSOR_CHEAP_MODEL_ID = 'claude-haiku-4-5';

/**
 * The Cursor SDK has no systemPrompt option, so Baguette injects its prompt as an
 * always-apply `.mdc` rules file. Both modes use the same filename under the
 * session cursor-dir, in per-mode folders:
 *   <cursor-dir>/build/.cursor/rules/system-prompt.mdc  — session builder prompt
 *   <cursor-dir>/review/.cursor/rules/system-prompt.mdc — reviewer prompt
 * Agent setup only ever receives its own mode folder, so an agent loads exactly
 * one prompt even though both files exist side by side. Prompt files left behind
 * by older Baguette versions (cursor-dir root, global review bucket) are never
 * pointed at by agent setup, so they are simply left alone.
 */
const SYSTEM_PROMPT_RULE_FILENAME = 'system-prompt.mdc';
const PROMPT_RULE_MODES = ['build', 'review'];

function extractUserText(parsed) {
  if (typeof parsed.content === 'string') return parsed.content;
  const content = parsed.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return expandUserContentForAgent(content);
  return '';
}

export class CursorAgentService {
  constructor() {
    this._activeSessions = new Map();
  }

  setup(app) {
    this.app = app;
  }

  async writeAlwaysApplyRule(
    rulesRoot,
    { filename = SYSTEM_PROMPT_RULE_FILENAME, description, body }
  ) {
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

  /**
   * Session cursor-dir root: sits alongside the session's working directory —
   * `.../sessions/<id>/cursor-dir` for session worktrees, alongside the shared
   * repos dir for global sessions. Sessions without a worktree path get no
   * rules dir (writePromptRule returns null).
   */
  cursorDirForSession(session) {
    const absoluteCwd = resolveDataDirRelativePath(session.worktree_path);
    if (!absoluteCwd) return null;
    return join(dirname(absoluteCwd), 'cursor-dir');
  }

  /**
   * Write the always-apply system prompt for one agent mode ('build' | 'review') and
   * return the rules root to pass as that agent's `dirs` entry. Each agent setup
   * only ever receives its own mode folder, so an agent loads exactly one prompt
   * even though both files exist side by side. Returns null for sessions without
   * a worktree path — no rules file is written for them.
   */
  async writePromptRule(session, mode, { description, body }) {
    if (!PROMPT_RULE_MODES.includes(mode)) {
      throw new Error(`Unknown cursor prompt mode: ${mode}`);
    }
    const cursorDir = this.cursorDirForSession(session);
    if (!cursorDir) return null;
    const rulesRoot = join(cursorDir, mode);
    await this.writeAlwaysApplyRule(rulesRoot, { description, body });
    return rulesRoot;
  }

  async resolveApiKey(session) {
    const user = await this.app.service('users').get(session.user_id, {});
    let repoApiKey = null;
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

  parseModelParams(modelParams) {
    if (!modelParams) return null;
    if (typeof modelParams !== 'string') return modelParams;
    try {
      return JSON.parse(modelParams);
    } catch {
      return null;
    }
  }

  async buildAgentOptions(
    session,
    { customTools, settingSources = ['project'], dirs, model, modelParams, apiKey } = {}
  ) {
    const cwd = resolveDataDirRelativePath(session.worktree_path) || '';
    const resolvedApiKey = apiKey !== undefined ? apiKey : await this.resolveApiKey(session);
    const resolvedTools = customTools ?? (await buildCursorCustomTools(session, this.app));
    const agentOptions = {
      apiKey: resolvedApiKey,
      local: {
        cwd,
        settingSources,
        dirs: dirs ?? [],
        customTools: resolvedTools,
        stateRoot: join(DATA_DIR, 'cursor-sdk-store'),
      },
    };
    const modelId = model ?? null;
    if (modelId) {
      let params = this.parseModelParams(modelParams);
      try {
        const user = await this.app.service('users').get(session.user_id, {});
        let repo = null;
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
          modelParams: params ?? modelParams,
          cursorModelPrefs: prefs,
        });
      } catch (err) {
        logger.warn(
          { sessionId: session.id, modelId, err: err.message },
          'cursor-agent: could not resolve model params from registry'
        );
      }
      agentOptions.model = params?.length ? { id: modelId, params } : { id: modelId };
    }
    return agentOptions;
  }

  async handleTableMessageCreated(row, table) {
    if (row.type !== 'user') return;

    const parsed = parseUserRow(row);
    if (!parsed || !isDispatchableUserMessage(parsed)) return;

    const sessionId = row.session_id;
    const session = await this.app.get('db')('sessions').where({ id: sessionId }).first();
    if (!session || session.archived_at) return;

    const channel = table === 'session-review-messages' ? 'review' : 'chat';
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
    const meta = { turnId: row.turn_id, channel, activeKey };
    attachAppErrorHandler(this.app, this._runTurn(session, parsed, turnModel, meta), {
      userId: session.user_id,
      sessionId: session.id,
    }).catch((err) => {
      logger.error({ sessionId, err: err.message }, 'cursor-agent turn failed');
    });
  }

  /** @deprecated use handleTableMessageCreated */
  async onMessageCreated(message) {
    return this.handleTableMessageCreated(message, 'messages');
  }

  async _prepareGlobalRulesDir(session) {
    if (!session.worktree_path) return null;
    const absoluteCwd = resolveDataDirRelativePath(session.worktree_path);
    const agentPrompt = await getEffectiveAgentPrompt(this.app, session.user_id, session.repo_id);
    // DB rows don't have absolute_worktree_path (added by the Feathers serializer), so inject it.
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

  async _getPluginDirs(session) {
    if (!session.plugins) return [];
    try {
      const pluginIds = JSON.parse(session.plugins);
      if (!Array.isArray(pluginIds) || pluginIds.length === 0) return [];
      const pluginRows = await this.app.get('db')('plugins').whereIn('id', pluginIds);
      const dirs = [];
      for (const p of pluginRows) {
        const pluginRoot = resolveDataDirRelativePath(p.local_path);
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

  async createOrResumeAgent(session, { agentOptions, resumeAgentId, persistAgentId }) {
    const sessionId = session.id;
    let agent;
    if (resumeAgentId) {
      logger.info(
        { sessionId, storedAgentId: resumeAgentId },
        'cursor-agent: resuming stored agent'
      );
      try {
        agent = await Agent.resume(resumeAgentId, agentOptions);
      } catch (err) {
        logger.warn(
          { sessionId, storedAgentId: resumeAgentId, err: err.message },
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

  async _sessionAgentOptions(session, turnModel = {}) {
    const user = await this.app.service('users').get(session.user_id, {});
    const baguetteRulesDir = await this._prepareGlobalRulesDir(session);
    const pluginDirs = await this._getPluginDirs(session);
    const dirs = [...(baguetteRulesDir ? [baguetteRulesDir] : []), ...pluginDirs];
    return this.buildAgentOptions(session, {
      dirs,
      model: turnModel.model ?? session.model ?? user.cursor_model ?? null,
      modelParams: turnModel.modelParams ?? session.model_params,
    });
  }

  async _sendWithBusyRetry(agent, session, userText, sendOptions = {}) {
    try {
      return await agent.send(userText, sendOptions);
    } catch (err) {
      const isActiveRunError =
        err instanceof AgentBusyError || err?.message?.includes('already has active run');
      if (!isActiveRunError) throw err;
      const cwd = resolveDataDirRelativePath(session.worktree_path) || '';
      const { items } = await Agent.listRuns(agent.agentId, { cwd });
      const stale = items.find((r) => r.status === 'running');
      if (stale) await stale.cancel();
      return agent.send(userText, sendOptions);
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
    resumeAgentId,
    persistAgentId,
    persistMessage,
    patchMessage,
    persistStatus,
    onStatus,
    onUsage,
    sendOptions = {},
    activeKey,
    abortController,
  }) {
    const key = activeKey ?? session.id;
    const sessionState = {
      isProcessing: true,
      userId: session.user_id,
      currentRun: null,
      abortController: abortController ?? new AbortController(),
    };
    this._activeSessions.set(key, sessionState);
    let outcome = 'failed';
    try {
      const agent = await this.createOrResumeAgent(session, {
        agentOptions,
        resumeAgentId,
        persistAgentId,
      });
      const run = await this._sendWithBusyRetry(agent, session, userText, sendOptions);
      sessionState.currentRun = run;
      const { finishedOk } = await processCursorRunStream(run, {
        persistMessage,
        patchMessage,
        onUsage,
        onStatus,
        abortSignal: sessionState.abortController.signal,
      });
      outcome = finishedOk ? 'completed' : 'failed';
      return { outcome, agent, run };
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error({ sessionId: session.id, err: err.message }, 'Cursor session stream error');
        try {
          await persistStatus?.(err.message);
        } catch {
          // ignore secondary errors
        }
        this.app.service('sessions').emit('app:error', {
          sessionId: session.id,
          message: err.message,
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

  async stopTurn(activeKey) {
    const session = this._activeSessions.get(activeKey);
    if (session) {
      try {
        session.abortController?.abort();
        await session.currentRun?.cancel();
      } catch {
        // ignore cancellation errors
      }
    }
    this._activeSessions.delete(activeKey);
  }

  async _runTurn(session, parsed, turnModel = {}, meta = {}) {
    const sessionId = session.id;
    const userId = session.user_id;
    const channel = meta.channel ?? 'chat';
    const activeKey = meta.activeKey ?? sessionId;
    const turnId = meta.turnId ?? null;
    let turnFinishedOk = false;
    // The user stopped the turn (sessions.stop); don't auto-dispatch queued messages.
    let userStopped = false;
    // The turn ended without finishing cleanly (follow-up/wake-up run died silently);
    // the session was settled out of a non-terminal status and queued messages can go.
    let turnEndedUnexpectedly = false;
    const db = this.app.get('db');
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

    const sessionState = {
      isProcessing: true,
      userId,
      currentRun: null,
      abortController: new AbortController(),
      writer,
      turnId,
      channel,
    };
    this._activeSessions.set(activeKey, sessionState);
    const turnUsage = emptyTurnUsage();
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
      const sendOptions = {};
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
        let lastCompletedRunId = run.id;

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
        } else if (!userStopped) {
          // A follow-up or wake-up run ended without a terminal status (e.g. the SDK
          // stream died silently), so the session may still be marked 'running' or
          // 'running' with nothing left to run. Settle it so new messages dispatch
          // instead of queueing forever, and let onTurnComplete drain the queue below.
          // A 'stopped' row (a user stop racing the send failure) is left alone.
          const current = await db('sessions').where({ id: sessionId }).first();
          const status = current?.status;
          if (status === 'running') {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
            await this._persistStatusMessage(
              sessionId,
              userId,
              'The turn ended unexpectedly.'
            ).catch(() => {});
          }
          if (status !== 'stopped') turnEndedUnexpectedly = true;
        }
      }

      if (turnFinishedOk && channel !== 'review') {
        await this._recordTurnUsage(session, agent, turnUsage, { turnModel }).catch((err) =>
          logger.warn({ sessionId, err: err.message }, 'cursor-agent: failed to record turn usage')
        );
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        handleAppError(this.app, err, { userId, sessionId });
        logger.error({ sessionId, err: err.message }, 'Cursor session stream error');
        try {
          if (channel === 'review') {
            await this.app.service('session-review').onAgentTurnComplete(session, 'failed', {
              sdk: 'cursor',
            });
            await this.app.service('session-review')._persistStatus(session, err.message);
          } else {
            await this.app
              .service('sessions')
              .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
            await this._persistStatusMessage(sessionId, userId, err.message);
          }
        } catch {
          // ignore secondary errors
        }
        this.app
          .service('sessions')
          .emit('app:error', { sessionId, message: err.message, user_id: userId });
      }
    } finally {
      const clearField =
        channel === 'review' ? { active_review_turn_id: null } : { active_chat_turn_id: null };
      await db('sessions')
        .where({ id: sessionId })
        .update(clearField)
        .catch(() => {});
      this._activeSessions.delete(activeKey);
    }

    // Agent is fully disposed — safe to start the next queued message as a fresh turn.
    // Runs on clean completion and on the unexpected-end recovery path (never after a
    // user stop), so queued messages don't sit forever when a run dies silently.
    if ((turnFinishedOk || turnEndedUnexpectedly) && channel !== 'review') {
      try {
        await this.app.service('sessions').onTurnComplete(sessionId);
      } catch (err) {
        logger.warn({ sessionId, err: err.message }, 'cursor-agent: failed to send queued message');
      }
    }
  }

  /**
   * Stream one run to completion. Returns { finishedOk, hasBackgroundTask }.
   * Handles ERROR/CANCELLED/EXPIRED by patching session status to 'failed' and persisting a message.
   * FINISHED is left for the caller to handle (so follow-up runs can be chained first).
   */
  async _streamOneRun(session, run, turnUsage = emptyTurnUsage(), turnModel = {}, streamOpts = {}) {
    const sessionId = session.id;
    const userId = session.user_id;
    const channel = streamOpts.channel ?? 'chat';
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
      onUsage: (sdkMsg) => {
        addTokenUsage(turnUsage, sdkMsg.usage);
        turnUsage.model = run.model?.id ?? turnModel.model ?? session.model ?? turnUsage.model;
      },
      onStatus: async (sdkMsg) => {
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
          let statusMsg;
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
  async _findFollowUpRun(session, agent, completedRunId) {
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
          { sessionId: session.id, err: err.message },
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
  async recordTurnUsage(session, agent, turnUsage, options = {}) {
    return this._recordTurnUsage(session, agent, turnUsage, options);
  }

  async _recordTurnUsage(session, agent, turnUsage, { kind, turnModel } = {}) {
    const db = this.app.get('db');
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
    const prevSessionCost = parseFloat(currentSession?.total_cost_usd ?? 0);
    await this.app
      .service('sessions')
      .patch(
        sessionId,
        { total_cost_usd: prevSessionCost + deltaCostUsd },
        { provider: undefined, user: { id: userId } }
      );
  }

  /** Per-turn USD from token counts when the model is in our pricing table; else 0. */
  _turnCostUsd(session, turnUsage, { kind, turnModel } = {}) {
    return estimateCursorUsageCostUsd(turnUsage, session, { kind, turnModel });
  }

  async _persistMessage(sessionId, userId, message) {
    return await this.app.service('messages').create(
      {
        session_id: sessionId,
        type: message.type,
        subtype: message.subtype ?? null,
        uuid: message.uuid ?? null,
        message_json: JSON.stringify(message),
        total_cost_usd: null,
      },
      { provider: undefined, user: { id: userId } }
    );
  }

  async _persistStatusMessage(sessionId, userId, statusText) {
    const payload = { type: 'system', subtype: 'status', status: statusText };
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

  async stopSession(sessionId) {
    await this.stopTurn(sessionId);
  }

  getActiveSession(sessionId) {
    return this._activeSessions.get(sessionId) ?? null;
  }

  async get(id) {
    return this.getActiveSession(id);
  }

  async deleteAgent(session) {
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

  async generateSessionMetadata(initialPrompt, shortId = '', user, repo = null) {
    const fallbackBranch = `task-${shortId}`;
    const prompt = `Generate metadata for a coding task. Output ONLY a JSON object with no markdown or explanation:
- "label": very short label (max 50 chars) summarizing the task
- "branch": short kebab-case git branch name suffixed with "-${shortId}" (e.g. "fix-auth-token-${shortId}"), max 60 chars

Task: ${initialPrompt}`;

    let label = '';
    let branchName = fallbackBranch;

    const fullUser = user?.id ? await this.app.service('users').get(user.id, {}) : null;

    let repoApiKey = null;
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
    });

    const run = await agent.send(prompt);
    let collectedText = '';

    for await (const sdkMsg of run.stream()) {
      if (sdkMsg.type === 'assistant') {
        for (const block of sdkMsg.message.content) {
          if (block.type === 'text') collectedText += block.text;
        }
      }
      if (
        sdkMsg.type === 'status' &&
        (sdkMsg.status === 'FINISHED' ||
          sdkMsg.status === 'ERROR' ||
          sdkMsg.status === 'CANCELLED' ||
          sdkMsg.status === 'EXPIRED')
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
        const parsed = JSON.parse(jsonText);
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

export function registerCursorAgentService(app, path = 'cursor-agent') {
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
