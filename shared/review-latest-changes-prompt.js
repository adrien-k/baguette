export const BAGUETTE_REVIEW_START_TITLE = 'Start review';
export const BAGUETTE_REVIEW_START_CONTENT =
  'Begin the code review following your system instructions.';

export const BAGUETTE_REVIEW_LATEST_TITLE = 'Review latest changes';

/** Client-owned copy for Issues → Review latest changes (no server git marker). */
export function buildReviewLatestChangesContent(baseBranch) {
  const base = baseBranch || 'main';
  return (
    `Review the latest changes against the base branch \`${base}\`. ` +
    `Focus on \`git diff ${base}...HEAD\` and uncommitted work, and reconcile findings with existing issues.`
  );
}
