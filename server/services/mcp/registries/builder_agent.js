import { createSessionAgentContext } from '../lib/session-agent-context.js';
import { createGitPullTool } from '../tools/git-pull.js';
import { createGitFetchTool } from '../tools/git-fetch.js';
import { createGitPushTool } from '../tools/git-push.js';
import { createCurrentSessionInfoMcpTool } from '../tools/current-session-info.js';
import { createUpdateSessionTool } from '../tools/update-session.js';
import { createSessionCostTool } from '../tools/session-cost.js';
import { createSystemStatsTool } from '../tools/system-stats.js';
import { createPrCommentsTool } from '../tools/pr-comments.js';
import { createPrMarkCommentViewedTool } from '../tools/pr-mark-comment-viewed.js';
import { createPrCommentTool } from '../tools/pr-comment.js';
import { createEditPrCommentTool } from '../tools/edit-pr-comment.js';
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
import { createUploadImageTool } from '../tools/upload-image.js';
import { createArchiveSlackThreadTool } from '../tools/archive-slack-thread.js';
import { createSlackPostMessageTool } from '../tools/slack-post-message.js';
import { createSlackReadThreadTool } from '../tools/slack-read-thread.js';
import { createSlackEditMessageTool } from '../tools/slack-edit-message.js';
import { createSlackReadChannelTool } from '../tools/slack-read-channel.js';
import { createSlackDownloadFileTool } from '../tools/slack-download-file.js';
import { createIssueHandlers } from '../lib/issue-handlers.js';
import { createCreateIssueTool } from '../tools/create-issue.js';
import { createUpdateIssueTool } from '../tools/update-issue.js';
import { createUpdateIssueStatusTool } from '../tools/update-issue-status.js';
import { createTodoHandlers } from '../lib/todo-handlers.js';
import { createCreateTodoTool } from '../tools/create-todo.js';
import { createUpdateTodoTool } from '../tools/update-todo.js';
import { createDeleteTodoTool } from '../tools/delete-todo.js';
import { createListTodosTool } from '../tools/list-todos.js';
import { createAskUserQuestionsTool } from '../tools/ask-user-questions.js';
import { createPlanHandlers } from '../lib/plan-handlers.js';
import { createCreatePlanTool } from '../tools/create-plan.js';
import { createStartPlanTool } from '../tools/start-plan.js';
import { createListPlansTool } from '../tools/list-plans.js';
import { createEditPlanTool } from '../tools/edit-plan.js';
import { createReadPlanTool } from '../tools/read-plan.js';
import { createCompletePlanTool } from '../tools/complete-plan.js';
import { createConfigureMcpServerTool } from '../tools/configure-mcp-server.js';
import { createStartReviewTool } from '../tools/start-review.js';
import { createContinueReviewTool } from '../tools/continue-review.js';

function buildBuilderIssueTools(ctx, session, app, agent) {
  const handlers = createIssueHandlers(session, app, agent ?? {});
  return [
    createCreateIssueTool(handlers),
    createUpdateIssueTool(ctx, { allowStatus: false }),
    createUpdateIssueStatusTool(ctx),
  ];
}

/** Repo session builder MCP tools (git, PR, tasks, issues for the coding agent). */
export function buildBuilderAgentTools(session, app, { slackApps = [], agent = null } = {}) {
  const ctx = createSessionAgentContext(session, app, { slackApps, callerAgent: agent });
  const todoHandlers = createTodoHandlers(session, app, { callerAgent: agent });
  const planHandlers = createPlanHandlers(session, app, { callerAgent: agent });
  const tools = [
    ...buildBuilderIssueTools(ctx, session, app, agent),
    createAskUserQuestionsTool(),
    createCreatePlanTool(planHandlers),
    createStartPlanTool(planHandlers),
    createListPlansTool(planHandlers),
    createEditPlanTool(planHandlers),
    createReadPlanTool(planHandlers),
    createCompletePlanTool(planHandlers),
    createCreateTodoTool(todoHandlers),
    createUpdateTodoTool(ctx),
    createDeleteTodoTool(ctx),
    createListTodosTool(ctx),
    createGitPullTool(ctx),
    createGitFetchTool(ctx),
    createGitPushTool(ctx),
    createCurrentSessionInfoMcpTool(ctx),
    createUpdateSessionTool(ctx),
    createPrCommentsTool(ctx),
    createPrMarkCommentViewedTool(ctx),
    createPrCommentTool(ctx),
    createEditPrCommentTool(ctx),
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
    createUploadImageTool(ctx),
    createConfigureMcpServerTool(ctx),
    createStartReviewTool(ctx),
    createContinueReviewTool(ctx),
  ];
  if (slackApps.length) tools.push(createSlackPostMessageTool(ctx));
  // Only Slack global session sessions read Slack and answer from it; other sessions skip the overhead.
  if (session.slack_app_id) {
    tools.push(
      createSlackEditMessageTool(ctx),
      createSlackReadThreadTool(ctx),
      createSlackReadChannelTool(ctx),
      createSlackDownloadFileTool(ctx),
      createArchiveSlackThreadTool(ctx),
      createSessionCostTool(ctx),
      createSystemStatsTool()
    );
  }
  return tools;
}

/** @deprecated Use buildBuilderAgentTools */
export function buildSessionAgentIssueMcpTools(session, app, agent = null) {
  const ctx = createSessionAgentContext(session, app, { callerAgent: agent });
  return buildBuilderIssueTools(ctx, session, app, agent);
}
