import { KnexService } from '@feathersjs/knex';
import { BadRequest, Forbidden, NotFound } from '@feathersjs/errors';
import { requireUser, scopeBySessionUser, only } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  assertIssueSeverity,
  assertIssueStatus,
} from '../session-issues.js';

export class SessionIssuesService extends KnexService {
  async create(data, params) {
    try {
      if (data.severity) assertIssueSeverity(data.severity);
      else throw new Error('severity is required');
      if (data.status) assertIssueStatus(data.status);
    } catch (err) {
      throw new BadRequest(err.message);
    }
    if (!data.title?.trim()) throw new BadRequest('title is required');
    return super.create(
      {
        session_id: data.session_id,
        severity: data.severity,
        title: data.title,
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
      if (data.status) assertIssueStatus(data.status);
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
}

function rejectExternalCreate(context) {
  if (context.params?.provider) {
    throw new Forbidden('Issues are created by the reviewer agent');
  }
  return context;
}

/** Closed issues are archived; list only when status is explicitly `closed`. */
export async function excludeClosedSessionIssues(context) {
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
    methods: ['find', 'get', 'create', 'patch', 'remove'],
  });
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeBySessionUser],
      find: [excludeClosedSessionIssues],
      create: [rejectExternalCreate],
      patch: [only(['status', 'title', 'description', 'severity'])],
    },
    after: {
      get: [hideClosedIssueOnGet],
    },
  });
}

export { ISSUE_SEVERITIES, ISSUE_STATUSES };
