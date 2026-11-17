import { KnexService } from '@feathersjs/knex';
import { BadRequest, Forbidden, NotFound } from 'feathers/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { requireOwnSessionForWrite } from './shared-access.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { issueFixAgentPrompt, issuesFixAllAgentPrompt } from '../../../shared/session-issues.js';
import {
  assertIssueSeverity,
  assertIssueStatus,
  assertAgentIssueStatus,
  parseStoredOptions,
  serializeIssueOptions,
  issueAwaitingDecision,
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
    let storedOptions = null;
    try {
      if (data.severity) assertIssueSeverity(data.severity);
      else throw new Error('severity is required');
      if (data.status) assertIssueStatus(data.status);
      if (data.options !== undefined) storedOptions = serializeIssueOptions(data.options);
    } catch (err) {
      throw new BadRequest(err.message);
    }
    const title = data.title != null ? String(data.title).trim() : '';
    if (!title) throw new BadRequest('title is required');
    const ref = await nextSessionItemRef(this.app.get('db'), 'session_issues', data.session_id);
    let status = data.status ?? 'opened';
    if (storedOptions) status = 'needs_decision';
    else if (status === 'needs_decision') status = 'opened';
    return super.create(
      {
        session_id: data.session_id,
        ref,
        severity: data.severity,
        title,
        description: data.description ?? '',
        status,
        options: storedOptions,
        selected_option_id: null,
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
    const current = await this.get(id, { user: params?.user });
    const patch = { ...data };
    const requestedStatus = patch.status;
    if (!params?.selectingOption) delete patch.selected_option_id;
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw new BadRequest('title is required');
      patch.title = title;
    }
    if (patch.description !== undefined) {
      patch.description = String(patch.description);
    }
    if (patch.options !== undefined) {
      let stored = null;
      try {
        stored = serializeIssueOptions(patch.options);
      } catch (err) {
        throw new BadRequest(err.message);
      }
      patch.options = stored;
      patch.selected_option_id = null;
      if (stored && !params?.agentStatusUpdate) patch.status = 'needs_decision';
      else if (!stored) {
        const nextStatus = statusWhenOptionsCleared(current, requestedStatus);
        if (nextStatus) patch.status = nextStatus;
        else delete patch.status;
      }
    }
    if (patch.options === undefined && patch.status === 'needs_decision') {
      const existing = parseStoredOptions(current?.options);
      if (!existing || existing.length === 0) patch.status = 'opened';
    }
    keepAwaitingDecision(patch, current, params);
    return super.patch(id, { ...patch, updated_at: new Date().toISOString() }, params);
  }

  async selectOption(data, params) {
    const id = selectOptionIssueId(data);
    const optionId = selectOptionId(data, params);
    if (id == null || id === '') throw new BadRequest('Issue id is required');
    if (!optionId) throw new BadRequest('option_id is required');
    const issue = await this.get(id, { user: params?.user });
    if (issue.status !== 'needs_decision') {
      throw new BadRequest('Only issues that need a decision can be selected');
    }
    const options = parseStoredOptions(issue.options) ?? [];
    const match = options.find((opt) => opt?.id === optionId);
    if (!match) throw new BadRequest('Unknown option');
    return this.patch(
      id,
      { selected_option_id: match.id, status: 'opened' },
      { user: params?.user, selectingOption: true }
    );
  }

  async _postBuilderFixMessage(session, text, params) {
    const content = String(text ?? '').trim();
    if (!content) throw new BadRequest('message is required');
    return this.app
      .service('sessions')
      .createDefaultBuilderMessage(
        { id: session.id, content },
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

/** Clearing options reopens a decision unless the caller set another status. */
function statusWhenOptionsCleared(current, requestedStatus) {
  if (requestedStatus && requestedStatus !== 'needs_decision') return requestedStatus;
  if (current?.status === 'needs_decision') return 'opened';
  if (requestedStatus === 'needs_decision') return 'opened';
  return requestedStatus;
}

const AWAITING_DECISION_STATUS_ERROR =
  'Issues that need a decision cannot change status until the user chooses an option';

/** Options with no selected_option_id stay needs_decision except selectOption, CloseIssue, or clearing options. */
function keepAwaitingDecision(patch, current, params) {
  if (params?.selectingOption) return;
  if (patch.status === 'closed') return;
  const nextOptions =
    patch.options !== undefined ? parseStoredOptions(patch.options) : current?.options;
  const nextSelected =
    patch.selected_option_id !== undefined ? patch.selected_option_id : current?.selected_option_id;
  if (!issueAwaitingDecision({ options: nextOptions, selected_option_id: nextSelected })) {
    return;
  }
  if (params?.agentStatusUpdate) {
    throw new BadRequest(AWAITING_DECISION_STATUS_ERROR);
  }
  patch.status = 'needs_decision';
}

function selectOptionIssueId(data) {
  if (data && typeof data === 'object') return data.id;
  return data;
}

function selectOptionId(data, params) {
  if (data && typeof data === 'object' && data.option_id != null) {
    const fromBody = String(data.option_id).trim();
    if (fromBody) return fromBody;
  }
  const fromQuery = params?.query?.option_id;
  if (fromQuery != null && String(fromQuery).trim()) return String(fromQuery).trim();
  if (params?.option_id != null && String(params.option_id).trim()) {
    return String(params.option_id).trim();
  }
  return '';
}

/** Custom methods are `(data, params)`. Put the row id on context.id for the ownership hook. */
function attachSelectOptionId(context) {
  const data = context.data;
  if (data && typeof data === 'object' && data.id != null) context.id = data.id;
  return context;
}

function withParsedOptions(row) {
  if (!row || typeof row !== 'object') return row;
  if (!Object.prototype.hasOwnProperty.call(row, 'severity')) return row;
  return {
    ...row,
    options: parseStoredOptions(row.options),
    selected_option_id: row.selected_option_id ?? null,
  };
}

function parseIssueOptionsResult(context) {
  const result = context.result;
  if (!result) return context;
  if (Array.isArray(result)) {
    context.result = result.map(withParsedOptions);
    return context;
  }
  if (Array.isArray(result.data)) {
    context.result = { ...result, data: result.data.map(withParsedOptions) };
    return context;
  }
  context.result = withParsedOptions(result);
  return context;
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
    methods: [
      'find',
      'get',
      'create',
      'patch',
      'remove',
      'askAgentToFix',
      'askAgentToFixAll',
      'selectOption',
    ],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeBySessionUser],
      find: [validateFindStatus, excludeClosedSessionIssues],
      create: [rejectExternalCreate],
      patch: [
        requireOwnSessionForWrite,
        only(['status', 'title', 'description', 'severity', 'options']),
      ],
      remove: [requireOwnSessionForWrite],
      askAgentToFix: [requireOwnSessionForWrite],
      askAgentToFixAll: [requireOwnSessionForWrite],
      selectOption: [attachSelectOptionId, requireOwnSessionForWrite],
    },
    after: {
      all: [parseIssueOptionsResult],
      get: [hideClosedIssueOnGet],
    },
  });
}
