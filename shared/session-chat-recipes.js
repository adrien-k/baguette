/** Built-in chat recipe ids (stable for client icons and e2e). */
export const BUILTIN_CHAT_RECIPE_IDS = {
  GIT_SYNC: 'git_sync',
  CHECK_CI: 'check_ci',
  CHECK_COMMENTS: 'check_comments',
};

const GIT_SYNC_PROMPT =
  'Please run GitPull to sync with the latest changes from the remote branch. Merge the base branch. If there are any merge conflicts, resolve them.';

const CHECK_CI_PROMPT =
  'Please check the CI workflow status using PrWorkflows. Fix any failing workflows.';

/** Must stay aligned with `## Responding to PR feedback` in `server/prompts/build-prompt.md`. */
const CHECK_COMMENTS_PROMPT_BUILDER =
  'Address open PR feedback by following the **Responding to PR feedback** section in your system instructions.';

const CHECK_COMMENTS_PROMPT_REVIEWER =
  'Call PrComments to load existing PR conversation and inline review comments, then summarize and continue per your review workflow.';

/**
 * @param {{ agent_type?: string | null }} [options]
 * @returns {Array<{ id: string, label: string, description: string, prompt: string, builtin: true }>}
 */
export function getBuiltinChatRecipes(options = {}) {
  const isReviewer = options.agent_type === 'reviewer';
  return [
    {
      id: BUILTIN_CHAT_RECIPE_IDS.GIT_SYNC,
      label: 'Git sync',
      description: 'Pull latest from the remote and base branch. Fix conflicts if any.',
      prompt: GIT_SYNC_PROMPT,
      builtin: true,
    },
    {
      id: BUILTIN_CHAT_RECIPE_IDS.CHECK_CI,
      label: 'Check CI',
      description: 'Check all PR workflow statuses and fix problems.',
      prompt: CHECK_CI_PROMPT,
      builtin: true,
    },
    {
      id: BUILTIN_CHAT_RECIPE_IDS.CHECK_COMMENTS,
      label: 'Check comments',
      description: isReviewer
        ? 'Check review comments.'
        : 'Check review comments and fix problems.',
      prompt: isReviewer ? CHECK_COMMENTS_PROMPT_REVIEWER : CHECK_COMMENTS_PROMPT_BUILDER,
      builtin: true,
    },
  ];
}
