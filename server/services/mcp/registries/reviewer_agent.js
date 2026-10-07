import { createIssueHandlers } from '../lib/issue-handlers.js';
import { createCurrentSessionInfoTool } from '../lib/current-session-info.js';
import { createCreateIssueTool } from '../tools/create-issue.js';
import { createUpdateIssueTool } from '../tools/update-issue.js';
import { createCloseIssueTool } from '../tools/close-issue.js';
import { buildSessionIssueReadTools } from './base_agent.js';

function loadSessionRow(session, app) {
  return async () => {
    const row = await app.get('db')('sessions').where({ id: session.id }).first();
    return row || session;
  };
}

/** Review-tab agent MCP tools. */
export function buildReviewerAgentTools(session, app, turnAgent = {}) {
  const h = createIssueHandlers(session, app, turnAgent);
  return [
    createCurrentSessionInfoTool(loadSessionRow(session, app), { readOnlySession: true }),
    createCreateIssueTool(h),
    ...buildSessionIssueReadTools(session, app),
    createUpdateIssueTool(h),
    createCloseIssueTool(h),
  ];
}

/** @deprecated Use buildReviewerAgentTools */
export function buildReviewerIssueMcpTools(session, app, turnAgent) {
  return buildReviewerAgentTools(session, app, turnAgent);
}
