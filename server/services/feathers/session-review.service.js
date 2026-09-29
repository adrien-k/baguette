import { join } from 'node:path';
import { BadRequest } from '@feathersjs/errors';
import logger from '../../logger.js';
import { requireUser, disableExternal } from './hooks.js';
import { getAllowedCommandsFromUser } from '../agent-settings.js';
import { buildReviewSystemPromptAppend } from '../session-prompt.js';
import { getEffectiveReviewPrompt } from '../effective-user-prompts.js';
import { combinePromptExtensions } from '../../../shared/agent-prompts.js';
import { buildReviewerMcpServer, buildReviewerCursorCustomTools } from '../baguette-mcp-server.js';
import { DATA_DIR, resolveDataDirRelativePath } from '../../config.js';
import { gitCommitCountSince } from '../github.js';
import { isGlobalSession } from '../../../shared/session-scope.js';
import { markSessionReviewedAtHead } from '../session-branch-commits.js';
import { addTokenUsage, emptyTurnUsage } from '../turn-usage.js';

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

function reviewSdk(session) {
  return session.review_agent_sdk || session.agent_sdk || 'claude';
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

function reviewTurnAgentMetadata(agentSdk, { model, modelParams }) {
  return {
    agent_sdk: agentSdk,
    model: model ?? null,
    model_params: agentSdk === 'cursor' ? (modelParams ?? null) : null,
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
      persist: { type: 'user', message: { role: 'user', content: trimmed } },
      sdkText: trimmed,
    };
  }
  const content = BAGUETTE_REVIEW_START_CONTENT;
  return {
    persist: {
      type: 'user',
      subtype: 'baguette',
      source: 'baguette',
      title: BAGUETTE_REVIEW_START_TITLE,
      message: { role: 'user', content },
    },
    sdkText: content,
  };
}

const REVIEW_TURN_ACTIVE_MESSAGE = 'Cannot send messages while a review turn is in progress';

const REVIEW_RESTART_PROMPT =
  'The Baguette server restarted and interrupted your previous review turn before it finished. ' +
  'Check the current issues and the working-tree diff, then continue the review from where you left off.';

export class SessionReviewService {
  constructor() {
    this._active = new Map();
  }

  setup(app) {
    this.app = app;
  }

  async _assertCanReview(session) {
    if (isGlobalSession(session)) {
      throw new BadRequest('Reviews are only available on repository sessions');
    }
    if (!session.worktree_path) {
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
    this._claimReviewTurn(session.id);

    try {
      const agentSdk = reviewSdk(session);
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
          review_initial_prompt: reviewInitialPromptFromStartData(data),
        },
        { user: { id: session.user_id } }
      );
      await this._wipeReviewMessages(session);
      this.app.service('sessions').resetClaudeUsageTotals(reviewTurnKey(session.id));

      const { persist: startMessage, sdkText: userMessageText } = buildReviewStartMessage(data);
      await this._persist(session, startMessage);

      const extraPrompt = data.extra_prompt;
      const run =
        agentSdk === 'cursor'
          ? this._runCursorReview(session, { model, modelParams, extraPrompt, userMessageText })
          : this._runClaudeReview(session, { model, extraPrompt, userMessageText });

      run.catch(async (err) => {
        logger.error({ sessionId: session.id, err: err.message }, 'session review failed');
        await this._dispose(session.id);
        await this._patchReviewStatus(session, 'failed').catch(() => {});
      });

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
    this._claimReviewTurn(session.id);

    try {
      const hasThread = await this.app
        .service('session-review-messages')
        .find({
          query: { session_id: session.id, $limit: 1 },
          paginate: false,
          provider: undefined,
          user: { id: session.user_id },
        })
        .then((rows) => (Array.isArray(rows) ? rows[0] : rows?.data?.[0]));
      if (!hasThread) {
        throw new BadRequest('Start a review before sending follow-up messages');
      }

      const agentSdk = reviewSdk(session);
      const { model, modelParams } = reviewTurnModel(session, data);

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
      const baguetteTitle =
        typeof data?.baguette_title === 'string' ? data.baguette_title.trim() : '';
      const userMessage = baguetteTitle
        ? {
            type: 'user',
            subtype: 'baguette',
            source: 'baguette',
            title: baguetteTitle,
            message: { role: 'user', content: message },
          }
        : {
            type: 'user',
            message: { role: 'user', content: message },
          };
      await this._persist(session, userMessage);

      const run =
        agentSdk === 'cursor'
          ? this._runCursorReview(session, {
              model,
              modelParams,
              userMessageText: message,
              continuation: true,
            })
          : this._runClaudeReview(session, {
              model,
              userMessageText: message,
              continuation: true,
            });

      run.catch(async (err) => {
        logger.error(
          { sessionId: session.id, err: err.message },
          'session review follow-up failed'
        );
        await this._dispose(session.id);
        await this._patchReviewStatus(session, 'failed').catch(() => {});
      });

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
    const cwd = resolveDataDirRelativePath(session.worktree_path);
    const message = marker
      ? newCommitsReviewText(marker, await gitCommitCountSince(cwd, marker))
      : latestChangesFromBaseText(session.base_branch);
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
        review_status: 'stopped',
        last_reviewed_commit_sha: null,
        review_initial_prompt: null,
      },
      { user: { id: session.user_id } }
    );
    return { ok: true };
  }

  async _persist(session, message) {
    return await this.app.service('session-review-messages').create(
      {
        session_id: session.id,
        type: message.type,
        subtype: message.subtype ?? null,
        uuid: message.uuid ?? null,
        message_json: JSON.stringify(message),
        total_cost_usd: message.type === 'result' ? (message.total_cost_usd ?? null) : null,
      },
      { provider: undefined, user: { id: session.user_id } }
    );
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
      .get('db')('session_review_messages')
      .where({ session_id: session.id })
      .pluck('id');
    for (const id of ids) {
      await this.app.service('session-review-messages').remove(id, userParams);
    }
  }

  async _userReviewPrompt(session, extraPrompt) {
    const base = await getEffectiveReviewPrompt(this.app, session.user_id, session.repo_id);
    if (extraPrompt != null && String(extraPrompt).trim()) {
      return combinePromptExtensions(base, extraPrompt);
    }
    return base;
  }

  _reviewPersist(session) {
    const userId = session.user_id;
    return {
      persistMessage: (message) => this._persist(session, message),
      persistStatus: (text) => this._persistStatus(session, text),
      patchMessage: (id, message) =>
        this.app.service('session-review-messages').patch(
          id,
          {
            type: message.type,
            message_json: JSON.stringify(message),
          },
          { provider: undefined, user: { id: userId } }
        ),
    };
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
    const fresh = await this.app.get('db')('sessions').where({ id: session.id }).first();
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
  }

  async _runClaudeReview(session, { model, extraPrompt, userMessageText, continuation = false }) {
    const systemPrompt = await this._prepareReviewPrompt(session, extraPrompt, continuation);
    const db = this.app.get('db');
    const sessionRow = await db('sessions').where({ id: session.id }).first();
    const resumeId = continuation ? sessionRow?.review_claude_session_id : null;
    const { persistMessage, persistStatus } = this._reviewPersist(session);

    const turnAgent = reviewTurnAgentMetadata('claude', { model });
    const queryOptions = await this.app.service('claude-agent').buildQueryOptions(session, {
      systemPrompt,
      mcpServer: buildReviewerMcpServer(session, this.app, turnAgent),
      allowedTools: REVIEWER_ALLOWED_TOOLS,
      settingSources: [],
      resume: resumeId,
      model: model || session.model,
      permissionMode: 'acceptEdits',
    });

    const { outcome } = await this.app.service('claude-agent').runTurn({
      sessionId: session.id,
      userId: session.user_id,
      prompt: userMessageText,
      queryOptions,
      persistMessage,
      persistStatus,
      onInitSessionId: (id) =>
        db('sessions').where({ id: session.id }).update({ review_claude_session_id: id }),
      onResult: (message) =>
        this.app
          .service('sessions')
          .recordClaudeUsage(session, message, {
            kind: 'review',
            model: model ?? session.review_model ?? session.model,
            totalsKey: reviewTurnKey(session.id),
            patchSessionCost: true,
          })
          .catch(() => {}),
      activeKey: reviewTurnKey(session.id),
      connectionClosedHint:
        'Review agent connection closed before the response finished. Try starting the review again.',
    });

    await this._finishReviewTurn(session, outcome);
  }

  async _runCursorReview(
    session,
    { model, modelParams, extraPrompt, userMessageText, continuation = false }
  ) {
    const systemPrompt = await this._prepareReviewPrompt(session, extraPrompt, continuation);
    const cursorAgent = this.app.service('cursor-agent');
    const db = this.app.get('db');
    const { persistMessage, persistStatus, patchMessage } = this._reviewPersist(session);

    const rulesRoot = join(DATA_DIR, 'review-cursor-rules', String(session.id));
    await cursorAgent.writeAlwaysApplyRule(rulesRoot, {
      filename: 'review.mdc',
      description: 'Baguette review rules (always applied)',
      body: systemPrompt,
    });

    const turnAgent = reviewTurnAgentMetadata('cursor', { model, modelParams });
    const agentOptions = await cursorAgent.buildAgentOptions(session, {
      customTools: buildReviewerCursorCustomTools(session, this.app, turnAgent),
      settingSources: [],
      dirs: [rulesRoot],
      model,
      modelParams,
    });

    const storedAgentId = continuation
      ? (await db('sessions').where({ id: session.id }).first())?.review_cursor_agent_id
      : null;

    const turnUsage = emptyTurnUsage();
    const { outcome, agent } = await cursorAgent.runTurn({
      session,
      userText: userMessageText,
      agentOptions,
      resumeAgentId: storedAgentId,
      persistAgentId: (agentId) =>
        db('sessions').where({ id: session.id }).update({ review_cursor_agent_id: agentId }),
      persistMessage,
      patchMessage,
      persistStatus,
      onUsage: (sdkMsg) => {
        addTokenUsage(turnUsage, sdkMsg.usage);
        turnUsage.model =
          sdkMsg.model ?? model ?? session.review_model ?? session.model ?? turnUsage.model;
      },
      onStatus: async (sdkMsg) => {
        const { status } = sdkMsg;
        if (status === 'FINISHED') {
          return { break: true, finishedOk: true };
        }
        if (status === 'ERROR' || status === 'CANCELLED' || status === 'EXPIRED') {
          const statusMsg =
            status === 'CANCELLED'
              ? 'Review was cancelled.'
              : `Review agent error.${sdkMsg.message ? ` ${sdkMsg.message}` : ''}`;
          await persistStatus(statusMsg);
          return { break: true, finishedOk: false };
        }
      },
      activeKey: reviewTurnKey(session.id),
    });

    if (outcome === 'completed' && agent) {
      await cursorAgent
        .recordTurnUsage(session, agent, turnUsage, {
          kind: 'review',
          turnModel: { model, modelParams },
        })
        .catch((err) =>
          logger.warn(
            { sessionId: session.id, err: err.message },
            'session review: failed to record cursor usage'
          )
        );
    }

    await this._finishReviewTurn(session, outcome);
  }

  async _dispose(sessionId) {
    this._active.delete(sessionId);
    const key = reviewTurnKey(sessionId);
    await this.app.service('claude-agent').stopTurn(key);
    await this.app.service('cursor-agent').stopTurn(key);
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
    if (isGlobalSession(session) || !session.worktree_path) {
      await this._persistStatus(session, 'Server restarted — review could not be resumed');
      await this._patchReviewStatus(session, 'failed');
      return false;
    }
    const sdk = reviewSdk(session);
    const resumable =
      sdk === 'cursor' ? !!session.review_cursor_agent_id : !!session.review_claude_session_id;
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
      await this._persist(session, {
        type: 'user',
        subtype: 'baguette',
        source: 'baguette',
        title: 'Server restarted',
        message: { role: 'user', content: REVIEW_RESTART_PROMPT },
      });
      const { model, modelParams } = reviewTurnModel(session);
      const run =
        sdk === 'cursor'
          ? this._runCursorReview(session, {
              model,
              modelParams,
              userMessageText: REVIEW_RESTART_PROMPT,
              continuation: true,
            })
          : this._runClaudeReview(session, {
              model,
              userMessageText: REVIEW_RESTART_PROMPT,
              continuation: true,
            });
      run.catch(async (err) => {
        logger.error({ sessionId: session.id, err: err.message }, 'resumed session review failed');
        await this._dispose(session.id);
        await this._patchReviewStatus(session, 'failed').catch(() => {});
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
