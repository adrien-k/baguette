import { BadRequest } from 'feathers/errors';
import { ok, fail } from './result.js';
import { sortIssuesBySeverity } from '../../../../shared/session-issues.js';
import { serializeIssue, issueAgentMetadataFromTurn, isIssueClosed } from '../../session-issues.js';

function serviceError(err) {
  if (err instanceof BadRequest) return fail(err.message);
  throw err;
}

function parseRef(ref) {
  const n = Number(ref);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

async function findIssueByRef(app, sessionId, ref, userId) {
  const result = await app.service('session-issues').find({
    query: { session_id: sessionId, ref, $limit: 1 },
    paginate: false,
    user: { id: userId },
  });
  const rows = Array.isArray(result) ? result : (result?.data ?? []);
  const issue = rows[0];
  if (!issue || isIssueClosed(issue)) return null;
  return issue;
}

export function createIssueHandlers(session, app, turnAgent = {}) {
  const userId = session.user_id;
  const sessionId = session.id;
  const userParams = { user: { id: userId } };
  const issueTurnAgent = issueAgentMetadataFromTurn(turnAgent);

  const fetchIssues = async ({ status } = {}) => {
    const query = { session_id: sessionId, $sort: { ref: 1 }, $limit: 100 };
    if (status != null) query.status = status;
    try {
      const result = await app.service('session-issues').find({
        query,
        paginate: false,
        user: { id: userId },
      });
      const rows = (Array.isArray(result) ? result : (result?.data ?? [])).filter(
        (row) => !isIssueClosed(row)
      );
      return { issues: sortIssuesBySeverity(rows.map(serializeIssue)) };
    } catch (err) {
      if (err instanceof BadRequest) return { error: err.message };
      throw err;
    }
  };

  return {
    async createIssue({ severity, title, description }) {
      try {
        const created = await app.service('session-issues').create(
          {
            session_id: sessionId,
            severity,
            title,
            description: description ?? '',
            status: 'opened',
            ...issueTurnAgent,
          },
          userParams
        );
        return ok({ issue: serializeIssue(created) });
      } catch (err) {
        return serviceError(err);
      }
    },

    async listIssues(args = {}) {
      const result = await fetchIssues(args);
      if (result.error) return fail(result.error);
      return ok({ issues: result.issues, count: result.issues.length });
    },

    async readIssue({ ref }) {
      const issueRef = parseRef(ref);
      if (issueRef == null) return fail('Invalid issue ref');
      const issue = await findIssueByRef(app, sessionId, issueRef, userId);
      if (!issue) return fail('Issue not found');
      return ok({ issue: serializeIssue(issue) });
    },

    async updateIssue({ ref, severity, title, description, status }) {
      const issueRef = parseRef(ref);
      if (issueRef == null) return fail('Invalid issue ref');
      const issue = await findIssueByRef(app, sessionId, issueRef, userId);
      if (!issue) return fail('Issue not found');
      const patch = {};
      if (severity != null) patch.severity = severity;
      if (status != null) patch.status = status;
      if (title != null) patch.title = title;
      if (description != null) patch.description = description;
      if (!Object.keys(patch).length) return fail('No fields to update');
      try {
        const updated = await app
          .service('session-issues')
          .patch(issue.id, patch, { provider: undefined, user: { id: userId } });
        return ok({ issue: serializeIssue(updated) });
      } catch (err) {
        return serviceError(err);
      }
    },

    async updateIssueStatus({ ref, status }) {
      const issueRef = parseRef(ref);
      if (issueRef == null) return fail('Invalid issue ref');
      const issue = await findIssueByRef(app, sessionId, issueRef, userId);
      if (!issue) return fail('Issue not found');
      try {
        const updated = await app
          .service('session-issues')
          .patch(issue.id, { status }, { user: { id: userId }, agentStatusUpdate: true });
        return ok({ issue: serializeIssue(updated) });
      } catch (err) {
        return serviceError(err);
      }
    },

    async closeIssue({ ref }) {
      const issueRef = parseRef(ref);
      if (issueRef == null) return fail('Invalid issue ref');
      const issue = await findIssueByRef(app, sessionId, issueRef, userId);
      if (!issue) return fail('Issue not found');
      try {
        const updated = await app
          .service('session-issues')
          .patch(issue.id, { status: 'closed' }, { provider: undefined, user: { id: userId } });
        return ok({ closed: serializeIssue(updated) });
      } catch (err) {
        return serviceError(err);
      }
    },
  };
}
