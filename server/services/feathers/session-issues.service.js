import { KnexService } from '@feathersjs/knex';
import { BadRequest, Forbidden } from '@feathersjs/errors';
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
    return super.patch(id, { ...data, updated_at: new Date().toISOString() }, params);
  }
}

function rejectExternalCreate(context) {
  if (context.params?.provider) {
    throw new Forbidden('Issues are created by the reviewer agent');
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
      create: [rejectExternalCreate],
      patch: [only(['status'])],
    },
  });
}

export { ISSUE_SEVERITIES, ISSUE_STATUSES };
