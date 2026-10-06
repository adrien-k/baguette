import { createSessionAgentContext } from '../lib/session-agent-context.js';
import { createIssueHandlers } from '../lib/issue-handlers.js';
import { createGitPullTool } from '../tools/git-pull.js';
import { createGitPushTool } from '../tools/git-push.js';
import { createGitFetchTool } from '../tools/git-fetch.js';
import { createCurrentSessionInfoMcpTool } from '../tools/current-session-info.js';
import { createUpdateSessionTool } from '../tools/update-session.js';
import { createPrUpsertTool } from '../tools/pr-upsert.js';
import { createPrCommentsTool } from '../tools/pr-comments.js';
import { createPrMarkCommentViewedTool } from '../tools/pr-mark-comment-viewed.js';
import { createPrCommentTool } from '../tools/pr-comment.js';
import { createPrReviewTool } from '../tools/pr-review.js';
import { createPrWorkflowsTool } from '../tools/pr-workflows.js';
import { createPrWorkflowLogsTool } from '../tools/pr-workflow-logs.js';
import { createListGithubPrsTool } from '../tools/list-github-prs.js';
import { createGetGithubPrTool } from '../tools/get-github-pr.js';
import { createAddGithubLabelTool } from '../tools/add-github-label.js';
import { createListGithubTagsTool } from '../tools/list-github-tags.js';
import { createListProjectCommandsTool } from '../tools/list-project-commands.js';
import { createRunTaskTool } from '../tools/run-task.js';
import { createAwaitDetachedTaskTool } from '../tools/await-detached-task.js';
import { createTaskStatusTool } from '../tools/task-status.js';
import { createKillTaskTool } from '../tools/kill-task.js';
import { createReadTaskOutputTool } from '../tools/read-task-output.js';
import { createConfigRepoPromptTool } from '../tools/config-repo-prompt.js';
import { createShowDiffTool } from '../tools/show-diff.js';
import { createUploadImageTool } from '../tools/upload-image.js';
import { createSlackPostMessageTool } from '../tools/slack-post-message.js';
import { createUpdateIssueStatusTool } from '../tools/update-issue-status.js';

export function buildBuilderIssueTools(session, app) {
  const h = createIssueHandlers(session, app);
  return [createUpdateIssueStatusTool(h)];
}

/** Repo session builder MCP tools (git, PR, tasks, issues for the coding agent). */
export function buildBuilderAgentTools(session, app, { slackApps = [] } = {}) {
  const ctx = createSessionAgentContext(session, app, { slackApps });
  const tools = [
    ...buildBuilderIssueTools(session, app),
    createGitPullTool(ctx),
    createGitPushTool(ctx),
    createGitFetchTool(ctx),
    createCurrentSessionInfoMcpTool(ctx),
    createUpdateSessionTool(ctx),
    createPrUpsertTool(ctx),
    createPrCommentsTool(ctx),
    createPrMarkCommentViewedTool(ctx),
    createPrCommentTool(ctx),
    createPrReviewTool(ctx),
    createPrWorkflowsTool(ctx),
    createPrWorkflowLogsTool(ctx),
    createListGithubPrsTool(ctx),
    createGetGithubPrTool(ctx),
    createAddGithubLabelTool(ctx),
    createListGithubTagsTool(ctx),
    createListProjectCommandsTool(ctx),
    createRunTaskTool(ctx),
    createAwaitDetachedTaskTool(ctx),
    createTaskStatusTool(ctx),
    createKillTaskTool(ctx),
    createReadTaskOutputTool(ctx),
    createConfigRepoPromptTool(ctx),
    createShowDiffTool(ctx),
    createUploadImageTool(ctx),
  ];
  if (slackApps.length) {
    tools.push(createSlackPostMessageTool(ctx));
  }
  return tools;
}

/** @deprecated Use buildBuilderIssueTools */
export function buildSessionAgentIssueMcpTools(session, app) {
  return buildBuilderIssueTools(session, app);
}

/** @deprecated Use buildBuilderAgentTools */
export function buildSessionAgentTools(session, app, options) {
  return buildBuilderAgentTools(session, app, options);
}
