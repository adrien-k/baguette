import { KnexService } from '@feathersjs/knex';
import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { issueFixAgentPrompt, issuesFixAllAgentPrompt } from '../../../shared/session-issues.js';
import { sessionMessageIdentity } from './message-create-fields.js';
import {
  assertIssueSeverity,
  assertIssueStatus,
  assertAgentIssueStatus,
} from '../session-issues.js';
import { nextSessionItemRef } from '../session-item-ref.js';

function issueActionParams(params) {
  return { user: params.user, provider: params.provider };
}

class SessionIssuesService extends KnexService {
  setup(app) {
    this.app = app;
  }

  async create(data, params) {
    try {
      if (data.severity) assertIssueSeverity(data.severity);
      else throw new Error('severity is required');
      if (data.status) assertIssueStatus(data.status);
    } catch (err) {
      throw new BadRequest(err.message);
    }
    const title = data.title != null ? String(data.title).trim() : '';
    if (!title) throw new BadRequest('title is required');
    const ref = await nextSessionItemRef(this.app.get('db'), 'session_issues', data.session_id);
    return super.create(
      {
        session_id: data.session_id,
        ref,
        severity: data.severity,
        title,
        description: data.description ?? '',
        status: data.status ?? 'opened',
        agent_sdk: data.agent_sdk ?? null,
        model: data.model ?? null,
        model_params: data.model_params ?? null,
      },
      params
    );
  }

  async patch(id, data, params) {
    try {
      if (data.severity) assertIssueSeverity(data.severity);
      if (data.status) {
        if (params?.agentStatusUpdate) assertAgentIssueStatus(data.status);
        else assertIssueStatus(data.status);
      }
    } catch (err) {
      throw new BadRequest(err.message);
    }
    const patch = { ...data };
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw new BadRequest('title is required');
      patch.title = title;
    }
    if (patch.description !== undefined) {
      patch.description = String(patch.description);
    }
    return super.patch(id, { ...patch, updated_at: new Date().toISOString() }, params);
  }

  async _postBuilderFixMessage(session, text, params) {
    const identity = sessionMessageIdentity(session, 'builder');
    const content = String(text ?? '').trim();
    if (!content) throw new BadRequest('message is required');
    return this.app.service('messages').create(
      {
        session_id: session.id,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content },
        }),
        ...identity,
      },
      { user: params.user, provider: params.provider }
    );
  }

  async askAgentToFix(issueId, params) {
    const issue = await this.get(issueId, params);
    if (issue.status !== 'opened') {
      throw new BadRequest('Only opened issues can be submitted for a fix');
    }
    const session = await this.app.service('sessions').get(issue.session_id, { user: params.user });
    const callParams = issueActionParams(params);
    await this._postBuilderFixMessage(session, issueFixAgentPrompt(issue, session.id), callParams);
    const patched = await this.patch(issue.id, { status: 'submitted' }, callParams);
    return { ok: true, issue: patched };
  }

  async askAgentToFixAll(data, params) {
    const sessionId = data?.session_id;
    if (!sessionId) throw new BadRequest('session_id is required');
    const session = await this.app.service('sessions').get(sessionId, { user: params.user });
    const callParams = issueActionParams(params);
    const found = await this.find({
      ...callParams,
      query: { session_id: session.id, status: 'opened', $limit: 500 },
      paginate: false,
    });
    const opened = Array.isArray(found) ? found : (found?.data ?? []);
    if (opened.length === 0) {
      throw new BadRequest('No opened issues to submit for a fix');
    }
    await this._postBuilderFixMessage(session, issuesFixAllAgentPrompt(session.id), callParams);
    const issues = [];
    for (const issue of opened) {
      issues.push(await this.patch(issue.id, { status: 'submitted' }, callParams));
    }
    return { ok: true, issues };
  }
}

function rejectExternalCreate(context) {
  if (context.params?.provider) {
    throw new Forbidden('Issues are created by the reviewer agent');
  }
  return context;
}

function validateFindStatus(context) {
  const status = context.params?.query?.status;
  if (status == null) return context;
  try {
    assertIssueStatus(status);
  } catch (err) {
    throw new BadRequest(err.message);
  }
  return context;
}

/** Closed issues are archived; list only when status is explicitly `closed`. */
async function excludeClosedSessionIssues(context) {
  if (context.method !== 'find') return context;
  const status = context.params?.query?.status;
  if (status != null) return context;

  const base = context.params.knex ?? context.service.createQuery(context.params);
  context.params.knex = base.whereNot(`${context.service.fullName}.status`, 'closed');
  return context;
}

function hideClosedIssueOnGet(context) {
  if (context.result?.status === 'closed' && context.params?.provider) {
    throw new NotFound('Issue not found');
  }
  return context;
}

export function registerSessionIssuesService(app, path = 'session-issues') {
  const options = {
    Model: app.get('db'),
    name: 'session_issues',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new SessionIssuesService(options), {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'askAgentToFix', 'askAgentToFixAll'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeBySessionUser],
      find: [validateFindStatus, excludeClosedSessionIssues],
      create: [rejectExternalCreate],
      patch: [only(['status', 'title', 'description', 'severity'])],
    },
    after: {
      get: [hideClosedIssueOnGet],
    },
  });
}
