import { BadRequest } from '@feathersjs/errors';
import logger from '../logger.js';
import { getAllowedCommandsFromUser } from './agent-settings.js';
import { buildReviewSystemPromptAppend } from './session-prompt.js';
import { getEffectiveReviewPrompt } from './effective-user-prompts.js';
import { combinePromptExtensions } from '../../shared/agent-prompts.js';
import {
  buildReviewerMcpServer,
  buildReviewerCursorCustomTools,
  buildReviewerPiCustomTools,
} from './baguette-mcp-server.js';
import { isGlobalSession } from '../../shared/session-scope.js';
import {
  BAGUETTE_REVIEW_START_CONTENT,
  BAGUETTE_REVIEW_START_TITLE,
} from '../../shared/review-latest-changes-prompt.js';
import { sessionMessageIdentity } from './feathers/message-create-fields.js';
import { agentServicePathForSession } from './agent-session-routing.js';
import { loadOwnedAgentConfig } from './agent-config-resolver.js';
import { getReviewerAgent } from './agents-db.js';
import { patchAgentInternal } from './feathers/agents.service.js';

function commandsToAllowedTools(commands) {
  return commands.map((cmd) => `Bash(${cmd}*)`);
}

const REVIEWER_ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'LS',
  ...commandsToAllowedTools(getAllowedCommandsFromUser()),
  'mcp__baguette__CreateIssue',
  'mcp__baguette__ListIssues',
  'mcp__baguette__ReadIssue',
  'mcp__baguette__UpdateIssue',
  'mcp__baguette__CloseIssue',
];

export function reviewTurnKey(agentId) {
  return `review:${agentId}`;
}

function reviewTurnAgentConfigIdFromData(agent, data = {}) {
  const raw = data?.agent_config_id ?? data?.review_agent_config_id;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  const fromAgent = agent?.agent_config_id;
  if (fromAgent != null && fromAgent !== '') {
    const n = Number(fromAgent);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function reviewTurnModel(agent, data = {}) {
  const model = data.model !== undefined && data.model !== '' ? data.model : (agent?.model ?? null);
  const modelParams =
    data.model_params !== undefined ? data.model_params : (agent?.model_params ?? null);
  return { model, modelParams };
}

/** Reviewer row identity: turn model + the validated review config, else review defaults. */
function reviewerRowIdentity(agent, data = {}, agentSdk = null) {
  const turnModel = reviewTurnModel(agent, data);
  return sessionMessageIdentity(agent, 'reviewer', {
    agent_sdk: agentSdk ?? data.agent_sdk,
    model: turnModel.model,
    model_params: turnModel.modelParams,
    agent_config_id: reviewTurnAgentConfigIdFromData(agent, data),
  });
}

function reviewTurnAgentMetadata(agentSdk, { model, modelParams }) {
  const supportsParams = agentSdk === 'cursor' || agentSdk === 'claude' || agentSdk === 'pi';
  return {
    agent_sdk: agentSdk,
    model: model ?? null,
    model_params: supportsParams ? (modelParams ?? null) : null,
  };
}

function reviewInitialPromptFromStartData(data) {
  const raw = data?.user_message ?? data?.initial_prompt;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || null;
}

export function buildReviewStartMessage(data) {
  const trimmed = reviewInitialPromptFromStartData(data);
  if (trimmed) {
    return {
      persist: { type: 'user', content: trimmed },
    };
  }
  const content = BAGUETTE_REVIEW_START_CONTENT;
  return {
    persist: {
      type: 'user',
      subtype: 'baguette',
      source: 'baguette',
      title: BAGUETTE_REVIEW_START_TITLE,
      content,
    },
  };
}

const REVIEW_RESTART_PROMPT =
  'The Baguette server restarted and interrupted your previous review turn before it finished. ' +
  'Check the current issues and the working-tree diff, then continue the review from where you left off.';

class ReviewAgentTurn {
  constructor() {
    /** @type {Map<number, { extraPrompt?: string, continuation?: boolean }>} */
    this._turnExtras = new Map();
  }

  peekTurnExtras(sessionId) {
    return this._turnExtras.get(sessionId) ?? null;
  }

  setTurnExtras(sessionId, extras) {
    this._turnExtras.set(sessionId, extras);
  }

  async resolveReviewSdk(agent, data = {}, session) {
    const reviewConfigId = reviewTurnAgentConfigIdFromData(agent, data);
    if (reviewConfigId == null) {
      throw new BadRequest('No agent configuration on this session');
    }
    const config = await loadOwnedAgentConfig(this.app.get('db'), reviewConfigId, session.user_id);
    return config.sdk;
  }

  async buildClaudeQueryOptions(
    session,
    agent,
    { model, modelParams, claudeEnv, continuation = false, extraPrompt } = {}
  ) {
    const systemPrompt = await this._prepareReviewPrompt(session, agent, extraPrompt, continuation);
    const resolvedParams = modelParams !== undefined ? modelParams : (agent?.model_params ?? null);
    const turnAgent = reviewTurnAgentMetadata('claude', { model, modelParams: resolvedParams });
    const resumeId = continuation ? agent?.claude_session_id : null;
    return await this.app.service('claude-agent').buildQueryOptions(session, {
      systemPrompt,
      mcpServer: buildReviewerMcpServer(session, this.app, turnAgent),
      allowedTools: REVIEWER_ALLOWED_TOOLS,
      settingSources: [],
      resume: resumeId,
      model,
      modelParams: resolvedParams,
      permissionMode: 'acceptEdits',
      claudeEnv,
    });
  }

  async buildPiReviewAgentOptions(
    session,
    agent,
    { model, modelParams, agentConfigId, continuation = false, extraPrompt } = {}
  ) {
    const systemPrompt = await this._prepareReviewPrompt(session, agent, extraPrompt, continuation);
    const resolvedParams = modelParams !== undefined ? modelParams : (agent?.model_params ?? null);
    const turnAgent = reviewTurnAgentMetadata('pi', { model, modelParams: resolvedParams });
    const piAgent = this.app.service('pi-agent');
    return await piAgent.buildAgentOptions(session, {
      model,
      modelParams: resolvedParams,
      agentConfigId,
      channel: 'review',
      customTools: buildReviewerPiCustomTools(session, this.app, turnAgent),
      storedPiSessionId: continuation ? agent?.pi_session_id : null,
      appendSystemPrompt: systemPrompt ? [systemPrompt] : [],
    });
  }

  async buildCursorReviewAgentOptions(
    session,
    agent,
    { model, modelParams, agentConfigId, continuation = false, extraPrompt } = {}
  ) {
    const systemPrompt = await this._prepareReviewPrompt(session, agent, extraPrompt, continuation);
    const cursorAgent = this.app.service('cursor-agent');
    const rulesRoot = await cursorAgent.writePromptRule(session, 'review', {
      description: 'Baguette review rules (always applied)',
      body: systemPrompt,
    });
    const turnAgent = reviewTurnAgentMetadata('cursor', { model, modelParams });
    return await cursorAgent.buildAgentOptions(session, {
      customTools: buildReviewerCursorCustomTools(session, this.app, turnAgent),
      settingSources: [],
      dirs: rulesRoot ? [rulesRoot] : [],
      model,
      modelParams,
      agentConfigId,
      channel: 'review',
    });
  }

  async stopReviewerAgent(session, reviewer) {
    if (!reviewer?.id) return;
    await this._dispose(session.id, reviewer.id);
    await this._patchReviewStatus(session, reviewer, 'stopped');
  }

  async onAgentTurnComplete(
    session,
    outcome,
    { sdk: _sdk, turnUsage: _turnUsage, agent: _agent, turnModel: _turnModel } = {}
  ) {
    this._turnExtras.delete(session.id);
    await this._finishReviewTurn(session, outcome);
  }

  /** Called when a queued review follow-up is about to dispatch after the prior turn ended. */
  async _beginQueuedReviewTurn(session) {
    this._turnExtras.set(session.id, { continuation: true });
    const reviewer = await getReviewerAgent(this.app.get('db'), session.id);
    if (reviewer) {
      await patchAgentInternal(this.app, reviewer.id, { status: 'running' }, session.user_id);
    }
    await this.app.service('sessions').onTurnStart(session.id);
  }

  setup(app) {
    this.app = app;
  }

  async _persist(session, reviewer, message, data = {}, agentSdk = null) {
    const row = {
      session_id: session.id,
      type: message.type,
      subtype: message.subtype ?? null,
      uuid: message.uuid ?? null,
      message_json: JSON.stringify(message),
      total_cost_usd: message.type === 'result' ? (message.total_cost_usd ?? null) : null,
    };
    Object.assign(row, reviewerRowIdentity(reviewer, data, agentSdk));
    return await this.app.service('messages').create(row, {
      provider: undefined,
      user: { id: session.user_id },
    });
  }

  async _persistStatus(session, statusText) {
    const reviewer = await getReviewerAgent(this.app.get('db'), session.id);
    if (!reviewer) return;
    await this._persist(session, reviewer, {
      type: 'system',
      subtype: 'status',
      status: statusText,
    });
  }

  async _patchReviewStatus(session, reviewer, status) {
    if (!reviewer?.id) return;
    await patchAgentInternal(this.app, reviewer.id, { status }, session.user_id);
  }

  async _userReviewPrompt(session, extraPrompt) {
    const base = await getEffectiveReviewPrompt(this.app, session.user_id, session.repo_id);
    if (extraPrompt != null && String(extraPrompt).trim()) {
      return combinePromptExtensions(base, extraPrompt);
    }
    return base;
  }

  async _prepareReviewPrompt(session, reviewer, extraPrompt, continuation) {
    const userPrompt = await this._userReviewPrompt(session, extraPrompt);
    const systemPrompt = await buildReviewSystemPromptAppend(session, userPrompt);
    if (!continuation && reviewer) {
      await this._persist(session, reviewer, {
        type: 'system',
        subtype: 'prompt',
        content: systemPrompt,
      });
    }
    return systemPrompt;
  }

  async _finishReviewTurn(session, outcome) {
    await this._dispose(session.id);
    const db = this.app.get('db');
    const reviewer = await getReviewerAgent(db, session.id);
    const hasQueued =
      reviewer?.id != null &&
      Boolean(
        await db('queued_messages')
          .where({ session_id: session.id, kind: 'turn', agent_id: reviewer.id })
          .first()
      );
    if (!hasQueued) {
      if (reviewer?.status === 'running') {
        await this._patchReviewStatus(session, reviewer, outcome);
      }
    } else {
      await this._beginQueuedReviewTurn(session);
    }

    if (reviewer?.id == null) return;
    await this.app
      .service('sessions')
      .flushNextQueuedTurn(session.id, reviewer.id)
      .catch((err) =>
        logger.warn(
          { sessionId: session.id, err: err.message },
          'Failed to flush queued review message'
        )
      );
  }

  async _dispose(sessionId, reviewerAgentId = null) {
    let agentId = reviewerAgentId;
    if (agentId == null) {
      const reviewer = await getReviewerAgent(this.app.get('db'), sessionId);
      agentId = reviewer?.id;
    }
    if (agentId == null) return;
    const key = reviewTurnKey(agentId);
    if ('claude-agent' in this.app.services) {
      await this.app.service('claude-agent').stopTurn(key);
    }
    if ('cursor-agent' in this.app.services) {
      await this.app.service('cursor-agent').stopTurn(key);
    }
    if ('pi-agent' in this.app.services) {
      await this.app.service('pi-agent').stopTurn(key);
    }
    if ('mock-agent' in this.app.services) {
      await this.app.service('mock-agent').stopTurn(key);
    }
  }

  async resumeInterrupted() {
    const db = this.app.get('db');
    let interrupted;
    try {
      interrupted = await db('sessions')
        .join('agents', 'agents.session_id', 'sessions.id')
        .where('agents.agent_type', 'reviewer')
        .where('agents.status', 'running')
        .whereNull('sessions.archived_at')
        .select('sessions.*', 'agents.id as reviewer_agent_id');
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to load interrupted reviews');
      return { resumed: 0, failed: 0 };
    }

    const counts = { resumed: 0, failed: 0 };
    for (const session of interrupted) {
      try {
        if (await this._resumeInterruptedReview(session, session.reviewer_agent_id))
          counts.resumed++;
        else counts.failed++;
      } catch (err) {
        counts.failed++;
        logger.error({ err, sessionId: session.id }, 'Failed to resume interrupted review');
        const reviewer = await getReviewerAgent(this.app.get('db'), session.id);
        if (reviewer) await this._patchReviewStatus(session, reviewer, 'failed').catch(() => {});
      }
    }
    return counts;
  }

  async _resumeInterruptedReview(session, reviewerAgentId) {
    const db = this.app.get('db');
    const reviewer =
      reviewerAgentId != null
        ? await db('agents').where({ id: reviewerAgentId, session_id: session.id }).first()
        : await getReviewerAgent(db, session.id);
    if (isGlobalSession(session) || !session.session_path) {
      await this._persistStatus(session, 'Server restarted — review could not be resumed');
      if (reviewer) await this._patchReviewStatus(session, reviewer, 'failed');
      return false;
    }
    const agentService = await agentServicePathForSession(this.app, session, { review: true });
    const resumable = await this.app
      .service(agentService)
      .isInterruptedSessionResumable(session, { channel: 'review', agent: reviewer });
    if (!resumable) {
      await this._persistStatus(session, 'Server restarted — review could not be resumed');
      if (reviewer) await this._patchReviewStatus(session, reviewer, 'failed');
      return false;
    }

    try {
      const activeReviewer = reviewer ?? (await getReviewerAgent(db, session.id));
      if (!activeReviewer) return false;
      await this._persistStatus(session, 'Server restarted — resuming review');
      this._turnExtras.set(session.id, { continuation: true });
      await this._persist(session, activeReviewer, {
        type: 'user',
        subtype: 'baguette',
        source: 'baguette',
        title: 'Server restarted',
        content: REVIEW_RESTART_PROMPT,
      });
      return true;
    } catch (err) {
      await this._dispose(session.id, reviewer?.id);
      await this._persistStatus(
        session,
        `Server restarted — could not resume review (${err.message})`
      ).catch(() => {});
      const failedReviewer = reviewer ?? (await getReviewerAgent(db, session.id));
      if (failedReviewer) {
        await this._patchReviewStatus(session, failedReviewer, 'failed').catch(() => {});
      }
      return false;
    }
  }
}

/** @param {import('@feathersjs/feathers').Application} app */
export function getReviewAgentTurn(app) {
  return app.get('reviewAgentTurn');
}

/** @param {import('@feathersjs/feathers').Application} app */
export function registerReviewAgentTurn(app) {
  const turn = new ReviewAgentTurn();
  app.set('reviewAgentTurn', turn);
  turn.setup(app);
}
