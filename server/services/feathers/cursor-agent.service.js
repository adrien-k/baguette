import { Agent, AgentBusyError } from '@cursor/sdk';
import { SqliteLocalAgentStore } from '@cursor/sdk/sqlite';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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

function isHumanUserMessage(parsed) {
  const content = parsed.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return !content.some((b) => b.type === 'tool_result');
  return false;
}

function extractUserText(parsed) {
  const content = parsed.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return expandUserContentForAgent(content);
  return '';
}

/** Max follow-up runs the wake-up loop may send per turn. */
export const BACKGROUND_WAKE_MAX_FOLLOW_UPS = 10;
/** How long the wake-up loop waits for the next task event before waking the agent anyway. */
export const BACKGROUND_WAKE_EVENT_TIMEOUT_MS = 10 * 60_000;
/**
 * Max consecutive wait timeouts (nothing reported) before the wake-up loop gives up:
 * ~1 hour of silence at the default 10-minute event timeout.
 */
export const BACKGROUND_WAKE_MAX_SILENT_CYCLES = 6;
/** Bytes of task output included in wake-up texts. */
const WAKE_OUTPUT_TAIL_BYTES = 4000;

/**
 * Session-level status for a task_notification row, consistent with the Claude
 * task_notification statuses ('completed' | 'failed' | 'cancelled').
 */
export function taskNotificationStatus(event) {
  if (event?.event !== 'exit') return 'running';
  if (event.status === 'stopped') return 'cancelled';
  return (event.exit_code ?? 1) === 0 ? 'completed' : 'failed';
}

/**
 * Human-readable summary of a background task wake-up event.
 */
export function describeTaskWakeStatus(event, task = null) {
  switch (event?.event) {
    case 'pattern':
      return task?.status && task.status !== 'running'
        ? `reported a match and then finished`
        : 'reported a pattern match (still running)';
    case 'exit':
      if (event.status === 'stopped') return 'was cancelled';
      if ((event.exit_code ?? 1) === 0) return 'exited successfully (exit code 0)';
      if (event.exit_code != null) return `exited with code ${event.exit_code}`;
      return `finished (${event.status ?? 'failed'})`;
    default:
      return 'has not reported yet (timed out waiting)';
  }
}

/**
 * Agent-facing text for a background task wake-up. Persisted as a user-role
 * message and sent to the agent so it continues its turn.
 */
export function buildTaskWakeText({ event, task = null }) {
  const desc = task?.label || (task?.command ? task.command.slice(0, 80) : null);
  const label = desc ? ` (${desc})` : '';
  const status = describeTaskWakeStatus(event, task);
  const lines = [
    `Background task notification: task #${event.task_id ?? 'unknown'}${label} ${status}.`,
  ];
  if (event.matched_line) lines.push(`Matched line: ${event.matched_line}`);
  const tail = task?.output_tail ?? event.output_tail;
  if (tail) {
    lines.push('Recent output:', tail.trimEnd());
  }
  lines.push(
    'Continue your work. Other monitored tasks will notify you when they report; use TaskStatus for a quick status or ReadTaskOutput for logs, and KillTask to stop one.'
  );
  return lines.join('\n');
}

/**
 * task_notification message recorded the moment a monitored task reports (pattern match
 * or exit) — same payload shape the wake-up drain used to persist, so the record exists
 * at event time even while a run is still streaming.
 */
export function taskNotificationPayload(event, task = null) {
  return {
    type: 'system',
    subtype: 'task_notification',
    uuid: randomUUID(),
    task_id: event.task_id,
    event: event.event,
    status: taskNotificationStatus(event),
    matched_line: event.matched_line ?? null,
    output_tail: task?.tailLogs(WAKE_OUTPUT_TAIL_BYTES) ?? null,
    ambient: false,
  };
}

/**
 * Deliver baguette-monitored background task wake-ups to the agent.
 *
 * Called from _runTurn after the main run finished: while the session has monitored
 * tasks (RunCommand with a notifyPattern) still running, mark the session
 * 'background', wait for the next event (pattern match or exit), mark the session
 * 'running', and send the agent a follow-up message so it continues working. Bounded by
 * maxFollowUps and eventTimeoutMs so the turn always ends eventually.
 *
 * Wait timeouts are not agent wakes: when nothing reports within eventTimeoutMs the
 * loop keeps waiting without waking the agent or consuming a follow-up slot, bounded
 * by maxSilentCycles so a task that never reports still ends the turn eventually.
 *
 * Task-event notification messages are persisted at event time by the turn's notify
 * watcher (watchSessionTaskNotifies); this loop only persists the synthetic wake_limit
 * notice. When the limit is reached (follow-ups exhausted or silence budget spent) it
 * tells the agent and cancels the remaining tasks so they don't linger (and don't
 * delay future turns).
 *
 * Returns 'drained' when there is nothing left to wait for, 'aborted' when the turn
 * was stopped by the user, or 'send_failed' when a follow-up run did not finish ok.
 * Dependencies are injectable for tests.
 */
export async function drainBackgroundTaskWakeups({
  listMonitoredPending,
  waitForEvent,
  getTask,
  persistNotification,
  sendFollowUp,
  killTask,
  setStatus = null,
  signal = null,
  maxFollowUps = BACKGROUND_WAKE_MAX_FOLLOW_UPS,
  eventTimeoutMs = BACKGROUND_WAKE_EVENT_TIMEOUT_MS,
  maxSilentCycles = BACKGROUND_WAKE_MAX_SILENT_CYCLES,
}) {
  let followUps = 0;
  let silentCycles = 0;
  while (!signal?.aborted) {
    const pending = listMonitoredPending();
    if (pending.length === 0) return 'drained';
    if (followUps >= maxFollowUps || silentCycles >= maxSilentCycles) {
      // Give up watching: tell the agent and cancel the remaining tasks so they
      // don't linger (and don't delay future turns).
      await persistNotification({
        type: 'system',
        subtype: 'task_notification',
        uuid: randomUUID(),
        task_id: null,
        event: 'wake_limit',
        status: 'cancelled',
        task_ids: pending.map((t) => t.id ?? t.task_id),
        matched_line: null,
        output_tail: null,
        ambient: false,
      });
      for (const t of pending) {
        await killTask(t.id ?? t.task_id, { reason: 'wake-up limit reached' });
      }
      return 'drained';
    }
    await setStatus?.('background');
    const event = await waitForEvent(
      pending.map((t) => t.id ?? t.task_id),
      { timeoutMs: eventTimeoutMs, signal }
    );
    if (signal?.aborted) return 'aborted';
    if (event?.event === 'timeout') {
      // Nothing reported within the wait window: keep waiting without waking the
      // agent or consuming a follow-up slot. The silence budget bounds the wait so
      // a task that never reports still ends the turn eventually.
      silentCycles += 1;
      continue;
    }
    silentCycles = 0;
    followUps += 1;
    await setStatus?.('running');
    const task = event.task_id ? getTask(event.task_id) : null;
    // No persistNotification here: task-event notifications are recorded at event time
    // by the turn's notify watcher (watchSessionTaskNotifies in _runTurn).
    const finishedOk = await sendFollowUp(buildTaskWakeText({ event, task }));
    if (!finishedOk) return 'send_failed';
  }
  return 'aborted';
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

  async onMessageCreated(message) {
    if (message.type !== 'user') return;

    const sessionId = message.session_id;

    const parsed =
      typeof message.message_json === 'string'
        ? JSON.parse(message.message_json)
        : message.message_json;

    // Only respond to human user messages, not tool_result messages we persisted ourselves
    if (!isHumanUserMessage(parsed)) return;

    const active = this._activeSessions.get(sessionId);
    if (active?.isProcessing) {
      // Force-send: steer the active run mid-turn instead of dropping the message
      if (message.force && active.currentRun?.steer) {
        const text = extractUserText(parsed);
        if (text) active.currentRun.steer(text).catch(() => {});
      }
      return;
    }

    const session = await this.app.get('db')('sessions').where({ id: sessionId }).first();
    if (
      !session ||
      session.archived_at ||
      session.status === 'archiving' ||
      session.status === 'archived' ||
      session.agent_sdk !== 'cursor'
    )
      return;
    if (session.repo_full_name && !session.worktree_path) return;

    const turnModel = resolveTurnModel(message, session);
    attachAppErrorHandler(this.app, this._runTurn(session, parsed, turnModel), {
      userId: session.user_id,
      sessionId: session.id,
    }).catch((err) => {
      logger.error({ sessionId, err: err.message }, 'cursor-agent turn failed');
    });
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
    // A stopped turn kills the agent's own background tasks and releases their
    // monitored-task wake-up obligations. User-started tasks (command panel) and
    // preview/devproxy tasks keep running. This runs even when no turn is
    // active: stopping an idle session must still reap the agent's leftover
    // background tasks (e.g. unmonitored tasks from its last completed turn).
    try {
      this.app.service('tasks')?.killSessionAgentTasks(activeKey, 'turn stopped by user');
    } catch (err) {
      logger.warn(
        { sessionId: activeKey, err: err.message },
        'cursor-agent: failed to kill agent tasks on stop'
      );
    }
    this._activeSessions.delete(activeKey);
  }

  async _runTurn(session, parsed, turnModel = {}) {
    const sessionId = session.id;
    const userId = session.user_id;
    let turnFinishedOk = false;
    // The user stopped the turn (sessions.stop); don't auto-dispatch queued messages.
    let userStopped = false;
    // The turn ended without finishing cleanly (follow-up/wake-up run died silently);
    // the session was settled out of a non-terminal status and queued messages can go.
    let turnEndedUnexpectedly = false;
    // Notify watcher unsubscribe; assigned once the turn starts (visible to finally).
    let unwatchNotifies = null;

    const sessionState = {
      isProcessing: true,
      userId,
      currentRun: null,
      abortController: new AbortController(),
    };
    this._activeSessions.set(sessionId, sessionState);
    const turnUsage = emptyTurnUsage();
    try {
      await this.app
        .service('sessions')
        .patch(sessionId, { status: 'running' }, { user: { id: userId } });
      await this.app.service('sessions').onTurnStart(sessionId);
      const tasksService = this.app.service('tasks');
      // Record task_notification messages the moment monitored tasks report — even
      // while a run is still streaming. Deliberate kills are skipped (their wake-up
      // was consumed and the wake_limit notice already covers them), and pattern
      // bursts coalesce to one record per task until a wake-up consumes the event.
      const recordedPatternTasks = new Set();
      unwatchNotifies = tasksService.watchSessionTaskNotifies(sessionId, (event, task) => {
        if (task._exitConsumed) return;
        if (event.event === 'pattern') {
          if (recordedPatternTasks.has(event.task_id)) return;
          recordedPatternTasks.add(event.task_id);
        }
        void this._persistMessage(sessionId, userId, taskNotificationPayload(event, task)).catch(
          (err) =>
            logger.warn(
              { sessionId, task_id: event.task_id, err: err.message },
              'cursor-agent: failed to persist task notification'
            )
        );
      });
      const db = this.app.get('db');
      const agentOptions = await this._sessionAgentOptions(session, turnModel);
      const agent = await this.createOrResumeAgent(session, {
        agentOptions,
        resumeAgentId: session.cursor_agent_id,
        persistAgentId: (agentId) =>
          db('sessions').where({ id: sessionId }).update({ cursor_agent_id: agentId }),
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
        turnModel
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
              await this._streamOneRun(session, followUpRun, turnUsage, turnModel);

            if (!followUpDone) {
              allDone = false;
              break;
            }
            lastCompletedRunId = followUpRun.id;
            if (!moreFollowUps) break;
          }
        }

        // Baguette-monitored background tasks (RunCommand with notifyPattern):
        // wait for wake-up events and deliver them to the agent as follow-up messages.
        // The events themselves were already recorded by the notify watcher above.
        if (allDone) {
          const wakeupStatus = await drainBackgroundTaskWakeups({
            signal: sessionState.abortController?.signal ?? null,
            listMonitoredPending: () =>
              tasksService
                .filterTasks({ sessionIds: new Set([sessionId]) })
                .filter((t) => t.notify_pending),
            waitForEvent: async (taskIds, opts) => {
              const event = await tasksService.waitForTaskEvent(taskIds, opts);
              // Consumed: the task's next match deserves its own notification record.
              if (event.task_id != null) recordedPatternTasks.delete(event.task_id);
              return event;
            },
            getTask: (taskId) => {
              const task = tasksService.getTask(taskId);
              if (!task) return null;
              const pub = task.toPublic();
              pub.output_tail = task.tailLogs(WAKE_OUTPUT_TAIL_BYTES);
              return pub;
            },
            setStatus: async (status) => {
              await this.app
                .service('sessions')
                .patch(sessionId, { status }, { user: { id: userId } });
            },
            persistNotification: (payload) => this._persistMessage(sessionId, userId, payload),
            sendFollowUp: async (text) => {
              // Persist the wake-up as a visible user message, then hand it to the agent.
              await this._persistMessage(sessionId, userId, {
                type: 'user',
                message: { role: 'user', content: text },
              });
              const wakeRun = await this._sendWithBusyRetry(agent, session, text, sendOptions);
              sessionState.currentRun = wakeRun;
              const { finishedOk } = await this._streamOneRun(
                session,
                wakeRun,
                turnUsage,
                turnModel
              );
              return finishedOk;
            },
            killTask: (taskId, opts = {}) => {
              const task = tasksService.getTask(taskId);
              return task
                ? task.kill({ reason: opts.reason ?? 'stopped' })
                : Promise.resolve(false);
            },
          });
          if (wakeupStatus === 'aborted') {
            // The user stopped the turn (sessions.stop sets status 'stopped' and
            // stopTurn already killed the agent's tasks). Don't fight that status,
            // and don't auto-dispatch queued messages after an explicit stop.
            userStopped = true;
            allDone = false;
            tasksService.killSessionAgentTasks(sessionId, 'turn stopped by user');
          } else if (wakeupStatus === 'send_failed') {
            allDone = false;
          }
        }

        if (allDone) {
          turnFinishedOk = true;
          await this.app
            .service('sessions')
            .patch(sessionId, { status: 'completed' }, { user: { id: userId } });
        } else if (!userStopped) {
          // A follow-up or wake-up run ended without a terminal status (e.g. the SDK
          // stream died silently), so the session may still be marked 'running' or
          // 'background' with nothing left to run. Settle it so new messages dispatch
          // instead of queueing forever, and let onTurnComplete drain the queue below.
          // A 'stopped' row (a user stop racing the send failure) is left alone.
          const current = await db('sessions').where({ id: sessionId }).first();
          const status = current?.status;
          if (status === 'running' || status === 'background') {
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

      if (turnFinishedOk) {
        await this._recordTurnUsage(session, agent, turnUsage, { turnModel }).catch((err) =>
          logger.warn({ sessionId, err: err.message }, 'cursor-agent: failed to record turn usage')
        );
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        handleAppError(this.app, err, { userId, sessionId });
        logger.error({ sessionId, err: err.message }, 'Cursor session stream error');
        try {
          await this.app
            .service('sessions')
            .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
          await this._persistStatusMessage(sessionId, userId, err.message);
        } catch {
          // ignore secondary errors
        }
        this.app
          .service('sessions')
          .emit('app:error', { sessionId, message: err.message, user_id: userId });
      }
    } finally {
      unwatchNotifies?.();
      this._activeSessions.delete(sessionId);
    }

    // Agent is fully disposed — safe to start the next queued message as a fresh turn.
    // Runs on clean completion and on the unexpected-end recovery path (never after a
    // user stop), so queued messages don't sit forever when a run dies silently.
    if (turnFinishedOk || turnEndedUnexpectedly) {
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
  async _streamOneRun(session, run, turnUsage = emptyTurnUsage(), turnModel = {}) {
    const sessionId = session.id;
    const userId = session.user_id;

    return processCursorRunStream(run, {
      persistMessage: (message) => this._persistMessage(sessionId, userId, message),
      patchMessage: (id, message) =>
        this.app
          .service('messages')
          .patch(
            id,
            { message_json: JSON.stringify(message) },
            { provider: undefined, user: { id: userId } }
          ),
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
          await this.app
            .service('sessions')
            .patch(sessionId, { status: 'failed' }, { user: { id: userId } });
          await this._persistStatusMessage(sessionId, userId, statusMsg);
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
  app.use(path, new CursorAgentService(), {
    methods: [
      'onMessageCreated',
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
