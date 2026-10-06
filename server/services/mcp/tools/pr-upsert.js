import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  getOpenPR,
  getOpenPRByNumber,
  upsertPR,
  splitPrBody,
  buildPrBody,
  buildSessionFooter,
} from '../../github.js';
import { loadBaguetteConfig } from '../../baguette-config.js';
import { getSessionPreviewUrl } from '../../preview-services.js';
import { loadSessionFooterUsageLines } from '../../pr-footer-usage.js';
import { ok, fail } from '../lib/result.js';

const execFileAsync = promisify(execFile);

export function createPrUpsertTool(ctx) {
  const {
    db,
    session,
    getSession,
    getToken,
    requireGitHubRepo,
    patchSession,
    absoluteWorktreePath,
    baseBranch,
  } = ctx;
  return {
    name: 'PrUpsert',
    description:
      "Create or update the pull request with a title and description. Call **`PrRead`** first so you incorporate earlier scope and do not replace the description with only this turn's changes. The description must reflect the **entire** branch diff against the base branch (see `CurrentSessionInfo` and `git diff origin/<base_branch>...HEAD`), not only the latest turn. **Follow the repo's GitHub pull request template** when one exists (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, or files under `.github/PULL_REQUEST_TEMPLATE/`): match its headings and section order and fill each section for the full branch. If there is no template, use ## Why and ## Summary (bullet lists for the full branch) and ## Test plan (only critical manual cases automated tests cannot cover). Write for reviewers: final behavior and test plan only—do not narrate abandoned approaches, reversals, or other intermediate session history.",
    schema: {
      title: z.string().describe('PR title'),
      description: z
        .string()
        .optional()
        .describe(
          'PR body (markdown). Use the repo GitHub PR template when present; otherwise ## Why and ## Summary (bullet lists for the full branch vs base) and ## Test plan (only critical cases not covered by automated tests). Refresh the full picture each call—never a changelog of only the last commit or last agent turn. Omit discarded ideas and "we tried X then Y" narrative.'
        ),
    },
    handler: async ({ title, description = '' }) => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      // Always persist label and description to session regardless of auto_push
      await patchSession({ label: title, pr_description: description });
      if (!session.auto_push) {
        return ok({
          message:
            'Auto-push is disabled. The PR has not been created/updated on GitHub. The user can push manually or enable auto-push using the controls at the bottom of the chat.',
        });
      }

      // Get fresh session to check current PR status (may have changed since tool list was built)
      const freshSession = await getSession();
      const currentPrStatus = freshSession?.pr_status;

      // Merged PRs cannot be reopened via GitHub API — treat as no PR and create a new one
      let effectivePrNumber = session.pr_number;
      if (effectivePrNumber && currentPrStatus === 'merged') {
        await patchSession({ pr_number: null, pr_url: null, pr_status: null });
        effectivePrNumber = null;
      }

      let head = freshSession.remote_branch || freshSession.local_branch || null;
      if (!effectivePrNumber) {
        if (!head) {
          const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: absoluteWorktreePath,
          });
          head = stdout.trim();
        }
        if (!head || head === 'HEAD') {
          return fail(
            'Cannot create a pull request from a detached HEAD. Check out a branch first.'
          );
        }
        const token = await getToken();
        const existing = token ? await getOpenPR(token, session.repo_full_name, head) : null;
        if (existing) {
          await patchSession({
            pr_url: existing.html_url,
            pr_number: existing.number,
            pr_status: existing.draft ? 'draft' : 'open',
            label: existing.title,
          });
          return fail(
            `A pull request already exists for branch "${head}" (#${existing.number}). ` +
              'The session was updated with this PR. Call PrRead again, and PrUpsert to update the title and description if needed.'
          );
        }
      }

      // Reopen if the PR was closed (but not merged — merged was handled above)
      const reopen = Boolean(effectivePrNumber && currentPrStatus === 'closed');

      // Preserve any user-written content above the baguette section
      let userPrefix = '';
      if (effectivePrNumber) {
        try {
          const existingPr = await getOpenPRByNumber(
            await getToken(),
            session.repo_full_name,
            effectivePrNumber
          );
          userPrefix = splitPrBody(existingPr?.body ?? '').userPrefix;
        } catch {
          // non-fatal — proceed without user prefix
        }
      }

      const prSession = freshSession ?? session;
      const baguetteConfig = absoluteWorktreePath
        ? await loadBaguetteConfig(absoluteWorktreePath)
        : null;
      const previewUrl = getSessionPreviewUrl(prSession, baguetteConfig);
      const usageLines = await loadSessionFooterUsageLines(db, prSession);
      const pr = await upsertPR(await getToken(), {
        repoFullName: session.repo_full_name,
        prNumber: effectivePrNumber,
        title,
        body: buildPrBody(
          userPrefix,
          description,
          buildSessionFooter(prSession, { previewUrl, usageLines })
        ),
        head,
        baseBranch,
        reopen,
      });
      if (!effectivePrNumber) {
        await patchSession({
          pr_url: pr.url,
          pr_number: pr.number,
          pr_status: 'draft',
        });
      } else if (reopen) {
        await patchSession({ pr_status: 'open' });
      }
      return ok({ url: pr.url, number: pr.number });
    },
  };
}
