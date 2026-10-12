import { BadRequest } from '@feathersjs/errors';
import logger from '../../logger.js';
import { requireUser, disableExternal } from './hooks.js';
import { getAllowedCommandsFromUser } from '../agent-settings.js';
import { buildReviewSystemPromptAppend } from '../session-prompt.js';
import { getEffectiveReviewPrompt } from '../effective-user-prompts.js';
import { combinePromptExtensions } from '../../../shared/agent-prompts.js';
import {
  buildReviewerMcpServer,
  buildReviewerCursorCustomTools,
  buildReviewerPiCustomTools,
} from '../baguette-mcp-server.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { gitCommitCountSince } from '../github.js';
import { isGlobalSession } from '../../../shared/session-scope.js';
import { markSessionReviewedAtHead } from '../session-branch-commits.js';
import { sessionMessageIdentity } from './message-create-fields.js';
import { agentServicePathForSession } from '../agent-session-routing.js';
import { loadOwnedAgentConfig } from '../agent-config-resolver.js';

const BAGUETTE_REVIEW_START_TITLE = 'Start review';
const BAGUETTE_REVIEW_START_CONTENT = 'Begin the code review following your system instructions.';

function newCommitsReviewText(marker, count) {
  if (count === 0) {
    return (
      `Review the latest changes since ${marker}. ` +
      `Focus on \`git diff ${marker}\` (including uncommitted work) and reconcile findings with existing issues.`
    );
  }
  return (
    `Review the latest changes since ${marker}. ` +
    `Focus on \`git diff ${marker}..HEAD\` and uncommitted work, and reconcile findings with existing issues.`
  );
}

function latestChangesFromBaseText(baseBranch) {
  const base = baseBranch || 'main';
  return (
    `Review the latest changes against the base branch \`${base}\`. ` +
    `Focus on \`git diff ${base}...HEAD\` and uncommitted work, and reconcile findings with existing issues.`
  );
}

const BAGUETTE_REVIEW_LATEST_TITLE = 'Review latest changes';

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

export function reviewTurnKey(sessionId) {
  return `review:${sessionId}`;
}

function reviewTurnModel(session, data = {}) {
  const model =
    data.model !== undefined && data.model !== ''
      ? data.model
      : (session.review_model ?? session.model ?? null);
  const modelParams =
    data.model_params !== undefined
      ? data.model_params
      : (session.review_model_params ?? session.model_params ?? null);
  return { model, modelParams };
}

function reviewUserRowFields(session, data = {}) {
  return sessionMessageIdentity(session, 'reviewer', {
    agent_sdk: data.agent_sdk,
    model: data.model,
    model_params: data.model_params,
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

function buildReviewStartMessage(data) {
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

const REVIEW_TURN_ACTIVE_MESSAGE = 'Cannot send messages while a review turn is in progress';

const REVIEW_RESTART_PROMPT =
  'The Baguette server restarted and interrupted your previous review turn before it finished. ' +
  'Check the current issues and the working-tree diff, then continue the review from where you left off.';

class SessionReviewService {
  constructor() {
    this._active = new Map();
    /** @type {Map<number, { extraPrompt?: string, continuation?: boolean }>} */
    this._turnExtras = new Map();
  }

  peekTurnExtras(sessionId) {
    return this._turnExtras.get(sessionId) ?? null;
  }

  async resolveReviewSdk(session) {
    const reviewConfigId = session.review_agent_config_id ?? session.agent_config_id ?? null;
    if (!reviewConfigId) {
      throw new BadRequest('No review agent configuration on this session');
    }
    const config = await loadOwnedAgentConfig(this.app.get('db'), reviewConfigId, session.user_id);
    return config.sdk;
  }

  async buildClaudeQueryOptions(
    session,
    { model, modelParams, continuation = false, extraPrompt } = {}
  ) {
    const systemPrompt = await this._prepareReviewPrompt(session, extraPrompt, continuation);
    const resolvedParams =
      modelParams !== undefined
        ? modelParams
        : (session.review_model_params ?? session.model_params ?? null);
    const turnAgent = reviewTurnAgentMetadata('claude', { model, modelParams: resolvedParams });
    const resumeId = continuation ? session.review_claude_session_id : null;
    return await this.app.service('claude-agent').buildQueryOptions(session, {
      systemPrompt,
      mcpServer: buildReviewerMcpServer(session, this.app, turnAgent),
      allowedTools: REVIEWER_ALLOWED_TOOLS,
      settingSources: [],
      resume: resumeId,
      model: model || session.review_model || session.model,
      modelParams: resolvedParams,
      permissionMode: 'acceptEdits',
    });
  }

  async buildPiReviewAgentOptions(
    session,
    { model, modelParams, continuation = false, extraPrompt } = {}
  ) {
    const systemPrompt = await this._prepareReviewPrompt(session, extraPrompt, continuation);
    const resolvedParams =
      modelParams !== undefined
        ? modelParams
        : (session.review_model_params ?? session.model_params ?? null);
    const turnAgent = reviewTurnAgentMetadata('pi', { model, modelParams: resolvedParams });
    const piAgent = this.app.service('pi-agent');
    return await piAgent.buildAgentOptions(session, {
      model: model || session.review_model || session.model,
      modelParams: resolvedParams,
      channel: 'review',
      customTools: buildReviewerPiCustomTools(session, this.app, turnAgent),
      storedPiSessionId: continuation ? session.review_pi_session_id : null,
      appendSystemPrompt: systemPrompt ? [systemPrompt] : [],
    });
  }

  async buildCursorReviewAgentOptions(
    session,
    { model, modelParams, continuation = false, extraPrompt } = {}
  ) {
    const systemPrompt = await this._prepareReviewPrompt(session, extraPrompt, continuation);
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
    });
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
    this._active.set(session.id, { pending: true });
    this._turnExtras.set(session.id, { continuation: true });
    await this.app
      .service('sessions')
      .patch(session.id, { review_status: 'running' }, { user: { id: session.user_id } });
    await this.app.service('sessions').onTurnStart(session.id);
  }

  setup(app) {
    this.app = app;
  }

  async _assertCanReview(session) {
    if (isGlobalSession(session)) {
      throw new BadRequest('Reviews are only available on repository sessions');
    }
    if (!session.session_path) {
      throw new BadRequest('Session worktree is not ready');
    }
  }

  _claimReviewTurn(sessionId) {
    if (this._active.has(sessionId)) {
      throw new BadRequest(REVIEW_TURN_ACTIVE_MESSAGE);
    }
    this._active.set(sessionId, { pending: true });
  }

  async start(data, params) {
    const sessionId = data?.session_id ?? data?.id;
    if (!sessionId) throw new BadRequest('session_id is required');
    const session = await this.app.service('sessions').get(sessionId, { user: params.user });
    await this._assertCanReview(session);
    if (session.review_status === 'running') {
      throw new BadRequest(REVIEW_TURN_ACTIVE_MESSAGE);
    }
    this._claimReviewTurn(session.id);

    try {
      const agentSdk = await this.resolveReviewSdk(session, data);
      const { model, modelParams } = reviewTurnModel(session, data);

      await this.app.service('sessions').patch(
        session.id,
        {
          review_status: 'running',
          review_agent_sdk: agentSdk,
          review_model: model,
          review_model_params: modelParams ?? null,
          review_claude_session_id: null,
          review_cursor_agent_id: null,
          review_pi_session_id: null,
          review_initial_prompt: reviewInitialPromptFromStartData(data),
        },
        { user: { id: session.user_id } }
      );
      await this.app.service('sessions').onTurnStart(session.id);
      await this._wipeReviewMessages(session);
      this.app.service('sessions').resetClaudeUsageTotals(reviewTurnKey(session.id));

      this._turnExtras.set(session.id, {
        extraPrompt: data.extra_prompt,
        continuation: false,
      });
      const { persist: startMessage } = buildReviewStartMessage(data);
      await this._persist(session, startMessage, data);

      return { ok: true, review_status: 'running' };
    } catch (err) {
      await this._dispose(session.id);
      await this._patchReviewStatus(session, 'failed').catch(() => {});
      throw err;
    }
  }

  async send(data, params) {
    const sessionId = data?.session_id ?? data?.id;
    if (!sessionId) throw new BadRequest('session_id is required');
    const message = String(data?.message ?? '').trim();
    if (!message) throw new BadRequest('message is required');

    const session = await this.app.service('sessions').get(sessionId, { user: params.user });
    await this._assertCanReview(session);

    const hasThread = await this.app
      .service('messages')
      .find({
        query: { session_id: session.id, agent_type: 'reviewer', $limit: 1 },
        paginate: false,
        provider: undefined,
        user: { id: session.user_id },
      })
      .then((rows) => (Array.isArray(rows) ? rows[0] : rows?.data?.[0]));
    if (!hasThread) {
      throw new BadRequest('Start a review before sending follow-up messages');
    }

    const baguetteTitle =
      typeof data?.baguette_title === 'string' ? data.baguette_title.trim() : '';
    const userMessage = baguetteTitle
      ? {
          type: 'user',
          subtype: 'baguette',
          source: 'baguette',
          title: baguetteTitle,
          content: message,
        }
      : {
          type: 'user',
          content: message,
        };

    const running = session.review_status === 'running' || this._active.has(session.id);
    if (running) {
      await this.app.service('queued-messages').create(
        {
          session_id: session.id,
          message_json: JSON.stringify(userMessage),
          kind: 'turn',
          ...reviewUserRowFields(session, data),
        },
        { user: params.user }
      );
      return { ok: true, queued: true };
    }

    this._claimReviewTurn(session.id);

    try {
      const hasThread = await this.app
        .service('messages')
        .find({
          query: { session_id: session.id, agent_type: 'reviewer', $limit: 1 },
          paginate: false,
          provider: undefined,
          user: { id: session.user_id },
        })
        .then((rows) => (Array.isArray(rows) ? rows[0] : rows?.data?.[0]));
      if (!hasThread) {
        throw new BadRequest('Start a review before sending follow-up messages');
      }

      const agentSdk = await this.resolveReviewSdk(session, data);
      const { model, modelParams } = reviewTurnModel(session, data);
      this._turnExtras.set(session.id, { continuation: true });

      const created = await this._persist(session, userMessage, data);
      if (created?.queued) {
        this._active.delete(session.id);
        return { ok: true, queued: true };
      }

      await this.app.service('sessions').patch(
        session.id,
        {
          review_status: 'running',
          review_agent_sdk: agentSdk,
          review_model: model,
          review_model_params: modelParams ?? null,
        },
        { user: { id: session.user_id } }
      );
      await this.app.service('sessions').onTurnStart(session.id);

      return { ok: true, review_status: 'running' };
    } catch (err) {
      await this._dispose(session.id);
      await this._patchReviewStatus(session, 'failed').catch(() => {});
      throw err;
    }
  }

  async reviewNewCommits(data, params) {
    const sessionId = data?.session_id ?? data?.id;
    if (!sessionId) throw new BadRequest('session_id is required');
    const session = await this.app.service('sessions').get(sessionId, { user: params.user });
    await this._assertCanReview(session);
    const marker = session.last_reviewed_commit_sha;
    const cwd = resolveDataDirRelativePath(session.session_path);
    let message = marker
      ? newCommitsReviewText(marker, await gitCommitCountSince(cwd, marker))
      : latestChangesFromBaseText(session.base_branch);
    const followUp = typeof data?.user_message === 'string' ? data.user_message.trim() : '';
    if (followUp) {
      message = `${message}\n\nAdditional instructions:\n${followUp}`;
    }
    const baguette_title = BAGUETTE_REVIEW_LATEST_TITLE;
    return this.send({ ...data, session_id: sessionId, message, baguette_title }, params);
  }

  async stop(data, params) {
    const sessionId = data?.session_id ?? data?.id;
    if (!sessionId) throw new BadRequest('session_id is required');
    const session = await this.app.service('sessions').get(sessionId, { user: params.user });
    await this._dispose(session.id);
    await this.app
      .service('sessions')
      .patch(session.id, { review_status: 'stopped' }, { user: { id: session.user_id } });
    return { ok: true };
  }

  async clearContext(data, params) {
    const sessionId = data?.session_id ?? data?.id;
    if (!sessionId) throw new BadRequest('session_id is required');
    const session = await this.app.service('sessions').get(sessionId, { user: params.user });
    if (this._active.has(sessionId) || session.review_status === 'running') {
      throw new BadRequest(REVIEW_TURN_ACTIVE_MESSAGE);
    }
    await this._wipeReviewMessages(session);
    this.app.service('sessions').resetClaudeUsageTotals(reviewTurnKey(session.id));
    await this.app.service('sessions').patch(
      session.id,
      {
        review_claude_session_id: null,
        review_cursor_agent_id: null,
        review_pi_session_id: null,
        review_status: null,
        last_reviewed_commit_sha: null,
        review_initial_prompt: null,
      },
      { user: { id: session.user_id } }
    );
    return { ok: true };
  }

  async _persist(session, message, data = {}) {
    const row = {
      session_id: session.id,
      type: message.type,
      subtype: message.subtype ?? null,
      uuid: message.uuid ?? null,
      message_json: JSON.stringify(message),
      total_cost_usd: message.type === 'result' ? (message.total_cost_usd ?? null) : null,
    };
    Object.assign(
      row,
      message.type === 'user'
        ? reviewUserRowFields(session, data)
        : sessionMessageIdentity(session, 'reviewer', {
            agent_sdk: data.agent_sdk,
            model: data.model,
            model_params: data.model_params,
          })
    );
    return await this.app.service('messages').create(row, {
      provider: undefined,
      user: { id: session.user_id },
    });
  }

  async _persistStatus(session, statusText) {
    await this._persist(session, {
      type: 'system',
      subtype: 'status',
      status: statusText,
    });
  }

  async _patchReviewStatus(session, review_status) {
    await this.app
      .service('sessions')
      .patch(session.id, { review_status }, { user: { id: session.user_id } });
  }

  async _wipeReviewMessages(session) {
    const userParams = { provider: undefined, user: { id: session.user_id } };
    const ids = await this.app
      .get('db')('session_messages')
      .where({ session_id: session.id, agent_type: 'reviewer' })
      .pluck('id');
    for (const id of ids) {
      await this.app.service('messages').remove(id, userParams);
    }
  }

  async _userReviewPrompt(session, extraPrompt) {
    const base = await getEffectiveReviewPrompt(this.app, session.user_id, session.repo_id);
    if (extraPrompt != null && String(extraPrompt).trim()) {
      return combinePromptExtensions(base, extraPrompt);
    }
    return base;
  }

  async _prepareReviewPrompt(session, extraPrompt, continuation) {
    const userPrompt = await this._userReviewPrompt(session, extraPrompt);
    const systemPrompt = await buildReviewSystemPromptAppend(session, userPrompt);
    if (!continuation) {
      await this._persist(session, {
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
    const hasQueued = await db('queued_messages')
      .where({ session_id: session.id, kind: 'turn', agent_type: 'reviewer' })
      .first();

    if (!hasQueued) {
      const fresh = await db('sessions').where({ id: session.id }).first();
      if (fresh?.review_status === 'running') {
        await this._patchReviewStatus(session, outcome);
      }
      if (outcome === 'completed') {
        await markSessionReviewedAtHead(this.app, session.id).catch((err) =>
          logger.warn(
            { sessionId: session.id, err: err.message },
            'Failed to mark session reviewed at head after review turn'
          )
        );
      }
    } else {
      await this._beginQueuedReviewTurn(session);
      if (outcome === 'completed') {
        await markSessionReviewedAtHead(this.app, session.id).catch((err) =>
          logger.warn(
            { sessionId: session.id, err: err.message },
            'Failed to mark session reviewed at head after review turn'
          )
        );
      }
    }

    await this.app
      .service('sessions')
      .flushNextQueuedTurn(session.id, 'reviewer')
      .catch((err) =>
        logger.warn(
          { sessionId: session.id, err: err.message },
          'Failed to flush queued review message'
        )
      );
  }

  async _dispose(sessionId) {
    this._active.delete(sessionId);
    const key = reviewTurnKey(sessionId);
    await this.app.service('claude-agent').stopTurn(key);
    await this.app.service('cursor-agent').stopTurn(key);
    if ('pi-agent' in this.app.services) {
      await this.app.service('pi-agent').stopTurn(key);
    }
  }

  async resumeInterrupted() {
    const db = this.app.get('db');
    let interrupted;
    try {
      interrupted = await db('sessions')
        .where({ review_status: 'running' })
        .whereNull('archived_at');
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to load interrupted reviews');
      return { resumed: 0, failed: 0 };
    }

    const counts = { resumed: 0, failed: 0 };
    for (const session of interrupted) {
      try {
        if (await this._resumeInterruptedReview(session)) counts.resumed++;
        else counts.failed++;
      } catch (err) {
        counts.failed++;
        logger.error({ err, sessionId: session.id }, 'Failed to resume interrupted review');
        await this._patchReviewStatus(session, 'failed').catch(() => {});
      }
    }
    return counts;
  }

  async _resumeInterruptedReview(session) {
    if (isGlobalSession(session) || !session.session_path) {
      await this._persistStatus(session, 'Server restarted — review could not be resumed');
      await this._patchReviewStatus(session, 'failed');
      return false;
    }
    const agentService = await agentServicePathForSession(this.app, session, { review: true });
    const resumable = await this.app
      .service(agentService)
      .isInterruptedSessionResumable(session, { channel: 'review' });
    if (!resumable) {
      await this._persistStatus(session, 'Server restarted — review could not be resumed');
      await this._patchReviewStatus(session, 'failed');
      return false;
    }

    try {
      this._claimReviewTurn(session.id);
    } catch (err) {
      if (err.message === REVIEW_TURN_ACTIVE_MESSAGE) return true;
      throw err;
    }
    try {
      await this._persistStatus(session, 'Server restarted — resuming review');
      this._turnExtras.set(session.id, { continuation: true });
      await this._persist(session, {
        type: 'user',
        subtype: 'baguette',
        source: 'baguette',
        title: 'Server restarted',
        content: REVIEW_RESTART_PROMPT,
      });
      return true;
    } catch (err) {
      await this._dispose(session.id);
      await this._persistStatus(
        session,
        `Server restarted — could not resume review (${err.message})`
      ).catch(() => {});
      await this._patchReviewStatus(session, 'failed').catch(() => {});
      return false;
    }
  }

  async get(id) {
    return this._active.get(Number(id)) ?? null;
  }
}

export function registerSessionReviewService(app, path = 'session-review') {
  app.use(path, new SessionReviewService(), {
    methods: ['start', 'stop', 'send', 'reviewNewCommits', 'clearContext', 'resumeInterrupted'],
  });
  app.service(path).hooks({
    before: {
      start: [requireUser],
      stop: [requireUser],
      send: [requireUser],
      reviewNewCommits: [requireUser],
      clearContext: [requireUser],
      resumeInterrupted: [disableExternal],
    },
  });
}
