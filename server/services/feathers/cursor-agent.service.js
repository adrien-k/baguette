import { Agent, AgentBusyError } from '@cursor/sdk';
import { SqliteLocalAgentStore } from '@cursor/sdk/sqlite';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import logger from '../../logger.js';
import { resolveDataDirRelativePath, DATA_DIR } from '../../config.js';
import { buildCursorCustomTools } from '../baguette-mcp-server.js';
import { buildSystemPromptAppend } from '../session-prompt.js';
import { addTokenUsage, emptyTurnUsage } from '../turn-usage.js';
import { formatCursorToolCallResult } from '../cursor-tool-call-result.js';

const CURSOR_CHEAP_MODEL_ID = 'claude-haiku-4-5';

// Cursor's usage endpoint is "server-derived and eventually consistent: cost can
// lag briefly after a run ends while billing events land" (see @cursor/sdk
// usage-types.d.ts). Reading it once the moment a run finishes usually returns a
// cost-less payload, so poll with a short backoff before giving up. The turn's
// queued follow-up waits on this, so the total budget stays small (~7s).
const COST_POLL_DELAYS_MS = [0, 1000, 2000, 4000];

// GET /v1/agents/:id/usage answers 403 `feature_unavailable` for every local
// agent id, including ids that never existed, while cloud ids on the same key
// answer 200 (and 404 `agent_not_found` when unknown). So this is a server-side
// feature flag on the local-agent runtime, not an account permission — despite
// the "not available for your account" message. It is permanent for the runtime,
// not a lag, so record it and stop asking.
const USAGE_FEATURE_UNAVAILABLE = 'feature_unavailable';

/** Cursor ids are `bc-<uuid>` for cloud agents and `agent-<uuid>` for local ones. */
function agentRuntime(agentId) {
  return String(agentId ?? '').startsWith('bc-') ? 'cloud' : 'local';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isHumanUserMessage(parsed) {
  const content = parsed.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return !content.some((b) => b.type === 'tool_result');
  return false;
}

function extractUserText(parsed) {
  const content = parsed.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

export class CursorAgentService {
  constructor() {
    this._activeSessions = new Map();
    // Agent runtimes ('local' / 'cloud') whose usage API answered
    // `feature_unavailable`. Scoped to the process so Cursor enabling the flag
    // is picked up on the next restart rather than needing a code change.
    this._usageUnavailable = new Set();
  }

  setup(app) {
    this.app = app;
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
    if (!session || session.archived_at || session.agent_sdk !== 'cursor') return;

    this._runTurn(session, parsed).catch((err) => {
      logger.error({ sessionId, err: err.message }, 'cursor-agent turn failed');
    });
  }

  async _prepareGlobalRulesDir(session) {
    const absoluteCwd = resolveDataDirRelativePath(session.worktree_path) || '';
    // New structure: worktree is at .../sessions/<id>/worktree — cursor-dir sits alongside it.
    // Old sessions: worktree_path points directly to the git root, fall back to DATA_DIR bucket.
    const sessionRulesRoot =
      basename(absoluteCwd) === 'worktree'
        ? join(dirname(absoluteCwd), 'cursor-dir')
        : join(DATA_DIR, 'cursor-rules', String(session.id));
    const rulesDir = join(sessionRulesRoot, '.cursor', 'rules');
    // DB rows don't have absolute_worktree_path (added by the Feathers serializer), so inject it.
    const systemPrompt = await buildSystemPromptAppend({
      ...session,
      absolute_worktree_path: absoluteCwd,
    });
    const mdcContent = `---
description: Baguette session rules (always applied)
alwaysApply: true
---

${systemPrompt}`;
    await mkdir(rulesDir, { recursive: true });
    await writeFile(join(rulesDir, 'baguette.mdc'), mdcContent, 'utf8');
    return sessionRulesRoot;
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

  async _getOrCreateAgent(session) {
    const sessionId = session.id;

    const db = this.app.get('db');
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

    const apiKey = repoApiKey || user.cursor_api_key || undefined;
    const cwd = resolveDataDirRelativePath(session.worktree_path) || '';

    const baguetteRulesDir = await this._prepareGlobalRulesDir(session);
    const pluginDirs = await this._getPluginDirs(session);

    const agentOptions = {
      apiKey,
      local: {
        cwd,
        settingSources: ['project'],
        dirs: [baguetteRulesDir, ...pluginDirs],
        customTools: buildCursorCustomTools(session, this.app),
        stateRoot: join(DATA_DIR, 'cursor-sdk-store'),
      },
    };

    const modelId = session.model || user.cursor_model || null;
    if (modelId) {
      let params = null;
      if (session.model_params) {
        try {
          params = JSON.parse(session.model_params);
        } catch {
          /* invalid JSON */
        }
      }
      agentOptions.model = params?.length ? { id: modelId, params } : { id: modelId };
    }

    let agent;
    if (session.cursor_agent_id) {
      logger.info(
        { sessionId, storedAgentId: session.cursor_agent_id },
        'cursor-agent: cache miss — resuming stored agent'
      );
      try {
        agent = await Agent.resume(session.cursor_agent_id, agentOptions);
      } catch (err) {
        logger.warn(
          { sessionId, storedAgentId: session.cursor_agent_id, err: err.message },
          'cursor-agent: resume failed, will create fresh agent'
        );
      }
    }
    if (!agent) {
      logger.info({ sessionId }, 'cursor-agent: creating new agent');
      agent = await Agent.create(agentOptions);
      await db('sessions').where({ id: sessionId }).update({ cursor_agent_id: agent.agentId });
    }

    return { agent };
  }

  async _runTurn(session, parsed) {
    const sessionId = session.id;
    const userId = session.user_id;
    let turnFinishedOk = false;

    const sessionState = { isProcessing: true, userId, currentRun: null };
    this._activeSessions.set(sessionId, sessionState);
    const turnUsage = emptyTurnUsage();

    try {
      await this.app
        .service('sessions')
        .patch(sessionId, { status: 'running' }, { user: { id: userId } });

      const { agent } = await this._getOrCreateAgent(session);
      const userText = extractUserText(parsed);

      const sendOptions = {};
      if (session.plan_mode) {
        sendOptions.mode = 'plan';
      }

      let run;
      try {
        run = await agent.send(userText, sendOptions);
      } catch (err) {
        const isActiveRunError =
          err instanceof AgentBusyError || err?.message?.includes('already has active run');
        if (!isActiveRunError) throw err;
        // Server restarted while a run was active. Cancel the stale run and retry once.
        const cwd = resolveDataDirRelativePath(session.worktree_path) || '';
        const { items } = await Agent.listRuns(agent.agentId, { cwd });
        const stale = items.find((r) => r.status === 'running');
        if (stale) await stale.cancel();
        run = await agent.send(userText, sendOptions);
      }
      sessionState.currentRun = run;

      const { finishedOk: mainFinished, hasBackgroundTask } = await this._streamOneRun(
        session,
        run,
        turnUsage
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
              await this._streamOneRun(session, followUpRun, turnUsage);

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
          await this.app
            .service('sessions')
            .patch(sessionId, { status: 'completed' }, { user: { id: userId } });
        }
      }

      if (turnFinishedOk) {
        await this._recordTurnUsage(session, agent, turnUsage).catch((err) =>
          logger.warn({ sessionId, err: err.message }, 'cursor-agent: failed to record turn usage')
        );
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
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
      this._activeSessions.delete(sessionId);
    }

    // Agent is fully disposed — safe to start the next queued message as a fresh turn.
    if (turnFinishedOk) {
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
  async _streamOneRun(session, run, turnUsage = emptyTurnUsage()) {
    const sessionId = session.id;
    const userId = session.user_id;
    const pendingToolCalls = new Map();
    let finishedOk = false;
    let hasBackgroundTask = false;

    // Cursor streams assistant text and thinking in per-word chunks.
    // Buffer each type and flush as a single message on type switch or non-streaming message.
    let streamBuffer = null; // { kind: 'assistant'|'thinking', msg: object, text: string }

    const flushStreamBuffer = async () => {
      if (!streamBuffer) return;
      if (streamBuffer.kind === 'assistant') {
        await this._persistMessage(sessionId, userId, streamBuffer.msg);
      } else {
        await this._persistMessage(sessionId, userId, {
          type: 'assistant',
          agent_id: streamBuffer.agentId,
          run_id: streamBuffer.runId,
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: streamBuffer.text }],
          },
        });
      }
      streamBuffer = null;
    };

    for await (const sdkMsg of run.stream()) {
      if (sdkMsg.type === 'assistant') {
        if (streamBuffer?.kind !== 'assistant') {
          await flushStreamBuffer();
          streamBuffer = {
            kind: 'assistant',
            msg: {
              ...sdkMsg,
              message: {
                ...sdkMsg.message,
                content: sdkMsg.message.content.map((b) => ({ ...b })),
              },
            },
          };
        } else {
          for (const block of sdkMsg.message.content) {
            if (block.type === 'text') {
              const existing = streamBuffer.msg.message.content.find((b) => b.type === 'text');
              if (existing) {
                existing.text += block.text;
              } else {
                streamBuffer.msg.message.content.push({ ...block });
              }
            } else {
              streamBuffer.msg.message.content.push({ ...block });
            }
          }
        }
        continue;
      }

      if (sdkMsg.type === 'thinking') {
        if (streamBuffer?.kind !== 'thinking') {
          await flushStreamBuffer();
          streamBuffer = {
            kind: 'thinking',
            agentId: sdkMsg.agent_id,
            runId: sdkMsg.run_id,
            text: sdkMsg.text ?? '',
          };
        } else {
          streamBuffer.text += sdkMsg.text ?? '';
        }
        continue;
      }

      // Any other message: flush the buffer first, then handle normally
      await flushStreamBuffer();

      // task messages indicate a background subagent was spawned — a follow-up run may arrive after FINISHED
      if (sdkMsg.type === 'task') hasBackgroundTask = true;

      // Emitted once at the end of each run, whenever the runtime reported usage.
      if (sdkMsg.type === 'usage') {
        addTokenUsage(turnUsage, sdkMsg.usage);
        // `run.model` is resolved by the time usage lands, so the row records what
        // actually served the turn rather than what the session asked for.
        turnUsage.model = run.model?.id ?? session.model ?? turnUsage.model;
      }

      await this._normalizeAndPersist(session, sdkMsg, pendingToolCalls);

      if (sdkMsg.type === 'status') {
        const { status } = sdkMsg;
        if (status === 'FINISHED') {
          finishedOk = true;
          break;
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
          break;
        }
      }
    }

    await flushStreamBuffer();
    return { finishedOk, hasBackgroundTask };
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

  async _normalizeAndPersist(session, sdkMsg, pendingToolCalls) {
    const sessionId = session.id;
    const userId = session.user_id;

    if (sdkMsg.type === 'tool_call') {
      if (sdkMsg.status === 'running') {
        if (!pendingToolCalls.has(sdkMsg.call_id)) {
          // First running event — persist tool_use immediately so it appears in the UI
          // before the tool finishes executing (args may still be streaming in).
          const persistedMsg = await this._persistMessage(sessionId, userId, {
            type: 'assistant',
            agent_id: sdkMsg.agent_id,
            run_id: sdkMsg.run_id,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: sdkMsg.call_id,
                  name: sdkMsg.name,
                  input: sdkMsg.args ?? {},
                },
              ],
            },
          });
          pendingToolCalls.set(sdkMsg.call_id, {
            name: sdkMsg.name,
            args: sdkMsg.args,
            agentId: sdkMsg.agent_id,
            runId: sdkMsg.run_id,
            persistedMsgId: persistedMsg.id,
          });
        } else {
          // Subsequent running events — accumulate args
          const pending = pendingToolCalls.get(sdkMsg.call_id);
          pendingToolCalls.set(sdkMsg.call_id, {
            ...pending,
            name: sdkMsg.name ?? pending.name,
            args: sdkMsg.args ?? pending.args,
          });
        }
      } else {
        // completed or error — update tool_use with final args, then persist tool_result
        const pending = pendingToolCalls.get(sdkMsg.call_id);
        const finalName = pending?.name ?? sdkMsg.name;
        const finalArgs = pending?.args ?? sdkMsg.args ?? {};

        if (pending?.persistedMsgId) {
          // Patch the already-persisted tool_use message with final args
          const finalToolUse = {
            type: 'assistant',
            agent_id: pending.agentId ?? sdkMsg.agent_id,
            run_id: pending.runId ?? sdkMsg.run_id,
            message: {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: sdkMsg.call_id, name: finalName, input: finalArgs },
              ],
            },
          };
          await this.app
            .service('messages')
            .patch(
              pending.persistedMsgId,
              { message_json: JSON.stringify(finalToolUse) },
              { provider: undefined, user: { id: userId } }
            );
        } else {
          await this._persistMessage(sessionId, userId, {
            type: 'assistant',
            agent_id: pending?.agentId ?? sdkMsg.agent_id,
            run_id: pending?.runId ?? sdkMsg.run_id,
            message: {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: sdkMsg.call_id, name: finalName, input: finalArgs },
              ],
            },
          });
        }

        const { content: resultContent, isError } = formatCursorToolCallResult(sdkMsg.result, {
          toolCallStatus: sdkMsg.status,
        });

        await this._persistMessage(sessionId, userId, {
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: sdkMsg.call_id,
                content: resultContent,
                is_error: isError,
              },
            ],
          },
        });

        pendingToolCalls.delete(sdkMsg.call_id);
      }
      return;
    }

    if (sdkMsg.type === 'task') {
      // Only persist if there's meaningful text to show
      if (sdkMsg.text) {
        await this._persistMessage(sessionId, userId, {
          type: 'system',
          subtype: 'task',
          task_status: sdkMsg.status ?? null,
          text: sdkMsg.text,
        });
      }
      return;
    }

    if (sdkMsg.type === 'request') {
      await this._persistMessage(sessionId, userId, {
        type: 'system',
        subtype: 'request',
        request_id: sdkMsg.request_id,
      });
      return;
    }

    // SDKSystemMessage, SDKStatusMessage (non-terminal), SDKUsageMessage: not persisted as chat messages
  }

  /**
   * Read the agent's cumulative cost in cents, polling through the backend's
   * billing lag. Returns null when the usage API is closed to this runtime.
   */
  async _fetchAgentCostCents(session, agent) {
    const sessionId = session.id;
    const runtime = agentRuntime(agent.agentId);

    for (let attempt = 0; attempt < COST_POLL_DELAYS_MS.length; attempt++) {
      if (COST_POLL_DELAYS_MS[attempt] > 0) await sleep(COST_POLL_DELAYS_MS[attempt]);

      let agentUsage;
      try {
        agentUsage = await agent.getUsage();
      } catch (err) {
        if (err?.code === USAGE_FEATURE_UNAVAILABLE) {
          this._usageUnavailable.add(runtime);
          logger.info(
            { sessionId, runtime },
            `cursor-agent: Cursor does not report usage for ${runtime} agents — session cost will not be tracked`
          );
          return null;
        }
        throw err;
      }

      // chargedCents is 0 for plan-included, BYOK and credit-grant usage, where
      // rawCostCents still carries the undiscounted model cost. Prefer what was
      // actually billed and fall back to the raw cost so those users see a figure.
      const cents = agentUsage.cost?.chargedCents || agentUsage.cost?.rawCostCents || 0;
      if (cents > 0) return cents;
    }

    logger.info(
      { sessionId },
      'cursor-agent: no cost reported for this turn after polling — backend may still be settling billing'
    );
    return 0;
  }

  /**
   * Record one `usage` row for the finished turn: the tokens the runtime reported
   * plus whatever cost the backend would admit to. Tokens are always available;
   * cost is 0 for local agents, so a row is written either way.
   */
  async _recordTurnUsage(session, agent, turnUsage) {
    const db = this.app.get('db');
    const sessionId = session.id;
    const userId = session.user_id;

    const deltaCostUsd = await this._turnCostDeltaUsd(session, agent);

    // Nothing to say about this turn at all — don't write an empty row.
    if (deltaCostUsd <= 0 && turnUsage.total_tokens <= 0) return;

    await db('usage').insert({
      session_id: sessionId,
      user_id: userId,
      repo_full_name: session.repo_full_name,
      cost_usd: Math.max(deltaCostUsd, 0),
      agent_sdk: 'cursor',
      input_tokens: turnUsage.input_tokens,
      output_tokens: turnUsage.output_tokens,
      cache_read_tokens: turnUsage.cache_read_tokens,
      cache_write_tokens: turnUsage.cache_write_tokens,
      reasoning_tokens: turnUsage.reasoning_tokens,
      total_tokens: turnUsage.total_tokens,
      model: turnUsage.model ?? session.model ?? null,
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

  /**
   * Cursor reports cost cumulatively for the whole agent, so this turn's share is
   * the total minus what the session already recorded. 0 when cost is unavailable.
   */
  async _turnCostDeltaUsd(session, agent) {
    if (this._usageUnavailable.has(agentRuntime(agent.agentId))) return 0;

    const totalCents = await this._fetchAgentCostCents(session, agent);
    if (!totalCents) return 0;

    const prevRow = await this.app
      .get('db')('usage')
      .where({ session_id: session.id })
      .sum('cost_usd as total')
      .first();
    return totalCents / 100 - parseFloat(prevRow?.total ?? 0);
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
    const session = this._activeSessions.get(sessionId);
    if (!session) return;
    try {
      await session.currentRun?.cancel();
    } catch {
      // ignore cancellation errors
    }
    this._activeSessions.delete(sessionId);
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
    methods: ['onMessageCreated', 'stopSession', 'generateSessionMetadata', 'deleteAgent'],
  });
}
