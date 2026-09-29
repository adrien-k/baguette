import { z } from 'zod';
import { BadRequest } from '@feathersjs/errors';
import { ok, fail } from './baguette-mcp-tool-result.js';
import { sortIssuesBySeverity } from '../../shared/session-issues.js';
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  REVIEWER_UPDATE_STATUSES,
  AGENT_ISSUE_STATUSES,
  serializeIssue,
  assertIssueSeverity,
  assertIssueStatus,
  assertAgentIssueStatus,
  issueAgentMetadataFromTurn,
  isIssueClosed,
} from './session-issues.js';
import { createCurrentSessionInfoTool } from './current-session-info.js';

async function requireIssue(app, sessionId, issueId, userId) {
  try {
    const issue = await app.service('session-issues').get(issueId, { user: { id: userId } });
    if (issue.session_id !== sessionId || isIssueClosed(issue)) return null;
    return issue;
  } catch {
    return null;
  }
}

function createHandlers(session, app, turnAgent = {}) {
  const userId = session.user_id;
  const sessionId = session.id;
  const userParams = { user: { id: userId } };
  const issueTurnAgent = issueAgentMetadataFromTurn(turnAgent);

  const fetchIssues = async ({ status, session_id: sessionIdArg } = {}) => {
    const targetSessionId = sessionIdArg ?? sessionId;
    if (targetSessionId !== sessionId) {
      try {
        await app.service('sessions').get(targetSessionId, { user: { id: userId } });
      } catch {
        return { error: 'Session not found' };
      }
    }
    if (status != null) {
      try {
        assertIssueStatus(status);
      } catch (err) {
        return { error: err.message };
      }
    }
    const query = { session_id: targetSessionId, $sort: { id: 1 }, $limit: 100 };
    if (status != null) query.status = status;
    const result = await app.service('session-issues').find({
      query,
      paginate: false,
      user: { id: userId },
    });
    const rows = (Array.isArray(result) ? result : (result?.data ?? [])).filter(
      (row) => !isIssueClosed(row)
    );
    return { issues: sortIssuesBySeverity(rows.map(serializeIssue)) };
  };

  return {
    async createIssue({ severity, title, description }) {
      try {
        assertIssueSeverity(severity);
      } catch (err) {
        return fail(err.message);
      }
      if (!title?.trim()) return fail('title is required');
      const created = await app.service('session-issues').create(
        {
          session_id: sessionId,
          severity,
          title: title.trim(),
          description: description ?? '',
          status: 'opened',
          ...issueTurnAgent,
        },
        userParams
      );
      return ok({ issue: serializeIssue(created) });
    },

    async listIssues(args = {}) {
      const result = await fetchIssues(args);
      if (result.error) return fail(result.error);
      return ok({ issues: result.issues, count: result.issues.length });
    },

    async readIssue({ issue_id }) {
      if (issue_id == null) {
        return fail('issue_id is required; use ListIssues to list issues');
      }
      const issue = await requireIssue(app, sessionId, issue_id, userId);
      if (!issue) return fail('Issue not found');
      return ok({ issue: serializeIssue(issue) });
    },

    async updateIssue({ issue_id, severity, title, description, status }) {
      const issue = await requireIssue(app, sessionId, issue_id, userId);
      if (!issue) return fail('Issue not found');
      const patch = {};
      try {
        if (severity != null) {
          assertIssueSeverity(severity);
          patch.severity = severity;
        }
        if (status != null) {
          assertIssueStatus(status);
          patch.status = status;
        }
      } catch (err) {
        return fail(err.message);
      }
      if (title != null) patch.title = title;
      if (description != null) patch.description = description;
      if (!Object.keys(patch).length) return fail('No fields to update');
      const updated = await app
        .service('session-issues')
        .patch(issue_id, patch, { provider: undefined, user: { id: userId } });
      return ok({ issue: serializeIssue(updated) });
    },

    async updateIssueStatus({ issue_id, status }) {
      try {
        assertAgentIssueStatus(status);
      } catch (err) {
        return fail(err.message);
      }
      const issue = await requireIssue(app, sessionId, issue_id, userId);
      if (!issue) return fail('Issue not found');
      const updated = await app
        .service('session-issues')
        .patch(issue_id, { status }, { user: { id: userId } });
      return ok({ issue: serializeIssue(updated) });
    },

    async closeIssue({ issue_id }) {
      const issue = await requireIssue(app, sessionId, issue_id, userId);
      if (!issue) return fail('Issue not found');
      const updated = await app
        .service('session-issues')
        .patch(issue_id, { status: 'closed' }, { provider: undefined, user: { id: userId } });
      return ok({ closed: serializeIssue(updated) });
    },
  };
}

const issueIdSchema = z.number().int().describe('Issue id');

function loadSessionRow(session, app) {
  return async () => {
    const row = await app.get('db')('sessions').where({ id: session.id }).first();
    return row || session;
  };
}

export function buildReviewerIssueMcpTools(session, app, turnAgent = {}) {
  const h = createHandlers(session, app, turnAgent);
  return [
    createCurrentSessionInfoTool(loadSessionRow(session, app), { readOnlyWorktree: true }),
    {
      name: 'CreateIssue',
      description:
        'Open a new review issue on this session. Severity is critical, high, medium, or low.',
      schema: {
        severity: z.enum(ISSUE_SEVERITIES).describe('Issue severity'),
        title: z.string().describe('Short issue title'),
        description: z.string().optional().describe('Details, including file paths'),
      },
      handler: h.createIssue,
    },
    {
      name: 'ListIssues',
      description:
        'List review issues for a session. Optional status filter (opened, submitted, ignored, resolved). session_id defaults to the current session.',
      schema: {
        status: z.enum(ISSUE_STATUSES).optional().describe('Filter by status'),
        session_id: z
          .number()
          .int()
          .optional()
          .describe('Session id (defaults to current session)'),
      },
      handler: h.listIssues,
    },
    {
      name: 'ReadIssue',
      description: 'Read one review issue by id.',
      schema: {
        issue_id: issueIdSchema,
      },
      handler: h.readIssue,
    },
    {
      name: 'UpdateIssue',
      description: 'Update an existing review issue (severity, title, description, and/or status).',
      schema: {
        issue_id: issueIdSchema,
        severity: z.enum(ISSUE_SEVERITIES).optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(REVIEWER_UPDATE_STATUSES).optional(),
      },
      handler: h.updateIssue,
    },
    {
      name: 'CloseIssue',
      description:
        'Close an issue after review (archived; hidden from ListIssues). Required after reviewing each resolved issue (whether fixed or not). If still broken, CreateIssue a new opened finding after closing.',
      schema: {
        issue_id: issueIdSchema,
      },
      handler: h.closeIssue,
    },
  ];
}

export function buildSessionAgentIssueMcpTools(session, app) {
  const h = createHandlers(session, app);
  return [
    {
      name: 'ListIssues',
      description:
        'List session review issues. Optional status filter (opened, submitted, ignored, resolved). session_id defaults to the current session.',
      schema: {
        status: z.enum(ISSUE_STATUSES).optional().describe('Filter by status'),
        session_id: z
          .number()
          .int()
          .optional()
          .describe('Session id (defaults to current session)'),
      },
      handler: h.listIssues,
    },
    {
      name: 'ReadIssue',
      description: 'Read one session review issue by id.',
      schema: {
        issue_id: issueIdSchema,
      },
      handler: h.readIssue,
    },
    {
      name: 'UpdateIssueStatus',
      description:
        'Set a session review issue to ignored or resolved after you have handled it. Do not use opened.',
      schema: {
        issue_id: issueIdSchema,
        status: z.enum(AGENT_ISSUE_STATUSES).describe('ignored or resolved'),
      },
      handler: h.updateIssueStatus,
    },
  ];
}

export { BadRequest };
