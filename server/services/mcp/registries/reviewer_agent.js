import { createIssueHandlers } from '../lib/issue-handlers.js';
import { createSessionAgentContext } from '../lib/session-agent-context.js';
import { createCurrentSessionInfoTool } from '../lib/current-session-info.js';
import { createCreateIssueTool } from '../tools/create-issue.js';
import { createUpdateIssueTool } from '../tools/update-issue.js';
import { createCloseIssueTool } from '../tools/close-issue.js';
import { buildSessionIssueReadTools } from './base_agent.js';
import { createAccountContext } from '../lib/account-context.js';
import { createListSkillsTool, createReadSkillTool } from '../tools/skills.js';

function loadSessionRow(session, app) {
  return async () => {
    const row = await app.get('db')('sessions').where({ id: session.id }).first();
    return row || session;
  };
}

/** Review-tab agent MCP tools. */
export function buildReviewerAgentTools(session, app, turnAgent = {}) {
  const h = createIssueHandlers(session, app, turnAgent);
  const ctx = createSessionAgentContext(session, app);
  const account = createAccountContext({ id: session.user_id }, app, { callerSession: session });
  return [
    createListSkillsTool(account),
    createReadSkillTool(account),
    createCurrentSessionInfoTool(loadSessionRow(session, app), {
      readOnlySession: true,
      getRepo: ctx.getRepo,
      getToken: ctx.getToken,
    }),
    createCreateIssueTool(h),
    ...buildSessionIssueReadTools(session, app),
    createUpdateIssueTool(ctx),
    createCloseIssueTool(ctx),
  ];
}

/** @deprecated Use buildReviewerAgentTools */
export function buildReviewerIssueMcpTools(session, app, turnAgent) {
  return buildReviewerAgentTools(session, app, turnAgent);
}
