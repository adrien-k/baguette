import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getGithubToken } from './agent-settings.js';
import {
  gitPull,
  gitPush,
  gitFetch,
  upsertPR,
  getOpenPR,
  getOpenPRByNumber,
  getPRComments,
  createPRComment,
  createPRLineComment,
  createPRReview,
  getPRWorkflows,
  getPRWorkflowLogs,
  addReactionToComment,
  listRepoPRs,
  addLabelsToPR,
  listRepoTags,
  splitPrBody,
  buildPrBody,
  buildSessionFooter,
} from './github.js';
import {
  loadBaguetteConfig,
  getAvailableCommands,
  getAvailableTasks,
  BaguetteConfigError,
} from './baguette-config.js';
import { getSessionPreviewUrl } from './preview-services.js';
import { loadSessionFooterUsageLines } from './pr-footer-usage.js';
import { isPortListening } from './port-utils.js';
import {
  getPermalink as slackGetPermalink,
  postMessage as slackPostMessage,
  resolveChannelId as slackResolveChannelId,
} from './slack.js';
import loadPrompt from '../prompts/loadPrompt.js';
import {
  DEFAULT_LOG_BYTES,
  MAX_LOG_RANGE_BYTES,
  sliceByteRange,
  validateLogByteRange,
} from './mcp-pagination.js';
import { IMAGES_DIR, PUBLIC_API_HOST, PUBLIC_HOST, resolveDataDirRelativePath } from '../config.js';
import { ok, fail } from './baguette-mcp-tool-result.js';
import { buildBaguetteAccountToolList } from './baguette-account-mcp-tools.js';
import {
  buildReviewerIssueMcpTools,
  buildSessionAgentIssueMcpTools,
} from './baguette-issue-mcp-tools.js';
import { GLOBAL_SESSION_EXCLUDED_MCP_TOOLS, isGlobalSession } from '../../shared/session-scope.js';
import { createCurrentSessionInfoTool } from './current-session-info.js';

const execFileAsync = promisify(execFile);

/** Split stream text into lines for JSON arrays (drops trailing empty segment from final newline). */
function streamToLines(text) {
  if (text === '' || text == null) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Slack apps with a usable bot token, via the admin CRUD service (internal = decrypted). */
async function loadConfiguredSlackApps(app) {
  const service = app.service?.('admin/slack');
  if (!service?.find) return [];
  try {
    const result = await service.find({ paginate: false });
    const rows = Array.isArray(result) ? result : (result?.data ?? []);
    return rows.filter((row) => row.bot_token);
  } catch {
    return [];
  }
}

function formatSlackAppList(apps) {
  return apps.map((a) => `"${a.name}"`).join(', ');
}

/**
 * Creates tool definitions shared between Claude SDK MCP server and Cursor customTools.
 * Returns an array of { name, description, schema (Zod shape), handler }.
 *
 * Slack tools are included only when at least one Slack app has a bot token.
 */
async function buildBaguetteToolList(session, app, { slackApps = [] } = {}) {
  const db = app.get('db');

  const getSession = async () => {
    const row = await db('sessions').where({ id: session.id }).first();
    if (row) {
      session = row;
      return row;
    }
    return session;
  };

  const getToken = async () => {
    const user = await app.service('users').get(session.user_id, {});
    return getGithubToken(user);
  };

  /** "Claude claude-opus-5" — the agent identity shown wherever baguette posts on a user's behalf. */
  const describeAgent = (session) => {
    const agentName = session?.agent_sdk === 'cursor' ? 'Cursor' : 'Claude';
    const modelId = (() => {
      const m = session?.model;
      if (!m) return null;
      try {
        const parsed = JSON.parse(m);
        if (parsed?.id) return parsed.id;
      } catch {
        /* not JSON */
      }
      return m;
    })();
    return modelId ? `${agentName} ${modelId}` : agentName;
  };

  const withSessionHeader = (body, session) => {
    const sessionId = session?.short_id || session?.id;
    return `*Posted by baguette - ${describeAgent(session)}, session ${sessionId}:*\n\n${body}`;
  };

  const getRepo = async () => {
    const s = await getSession();
    if (!s.repo_id) return null;
    return db('repos').where({ id: s.repo_id }).first();
  };

  const requireGitHubRepo = async () => {
    const repo = await getRepo();
    const fn = repo?.full_name;
    if (fn && (fn.startsWith('/') || !fn.includes('/'))) {
      return fail(
        'This repository is not connected to GitHub. Push and PR features are unavailable.'
      );
    }
    return null;
  };

  const patchSession = async (data) => {
    const updated = await app
      .service('sessions')
      .patch(session.id, data, { provider: undefined, user: { id: session.user_id } });
    session = { ...session, ...updated };
  };

  const absoluteWorktreePath = resolveDataDirRelativePath(session.worktree_path) || '';
  const { base_branch: baseBranch } = session;

  // ── Slack helpers ──────────────────────────────────────────────────────────

  const sessionUrl = (s) => `${PUBLIC_HOST}/sessions/${s.id}`;

  const slackAppNames = slackApps.map((a) => a.name);
  const slackAppHint =
    slackAppNames.length > 1
      ? `One of: ${formatSlackAppList(slackApps)}.`
      : slackAppNames.length === 1
        ? `Defaults to "${slackAppNames[0]}".`
        : 'Configured in Settings → Integrations.';

  /** Picks a Slack app by name, or the only configured one. Reloads in case apps changed mid-session. */
  const resolveSlackApp = async (appName) => {
    const apps = await loadConfiguredSlackApps(app);
    if (!apps.length) {
      throw new Error('Slack is not configured. Add a Slack app in Settings → Integrations.');
    }
    if (appName) {
      const found = apps.find((a) => a.name === appName);
      if (!found) {
        throw new Error(`Unknown Slack app "${appName}". Available: ${formatSlackAppList(apps)}.`);
      }
      return found;
    }
    if (apps.length === 1) return apps[0];
    throw new Error(
      `Multiple Slack apps configured (${formatSlackAppList(apps)}). Pass \`app\` to choose one.`
    );
  };

  /** Slack messages carry their origin so a human can jump from the thread to the session. */
  const withSlackFooter = (text, s) =>
    `${text}\n\n_via <${sessionUrl(s)}|baguette> · ${describeAgent(s)} · session ${s.short_id || s.id}_`;

  /** Slack failures are expected (bad channel, missing scope) — report them, don't crash the turn. */
  const slackHandler = (handler) => async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      return fail(err.message);
    }
  };

  let accountTools = [];
  try {
    const owner = await app.service('users').get(session.user_id, {});
    accountTools = buildBaguetteAccountToolList(owner, app, { callerSession: session });
  } catch {
    accountTools = [];
  }

  const slackTools = [
    {
      name: 'SlackPostMessage',
      description:
        'Post a message to a Slack channel — for example to report a finished task or a failing ' +
        'build to the team. Returns the message `ts` and a permalink. Text uses Slack mrkdwn: ' +
        '*bold*, _italic_, `code`, ```block```, <https://url|label>.',
      schema: {
        text: z.string().describe('Message text (Slack mrkdwn)'),
        channel: z
          .string()
          .describe('Channel id (e.g. C0123ABCD) or name (e.g. #eng). Invite the bot to it first.'),
        app: z.string().optional().describe(`Slack app to post as. ${slackAppHint}`),
      },
      handler: slackHandler(async ({ text, channel, app: appName }) => {
        const slackApp = await resolveSlackApp(appName);
        const channelId = await slackResolveChannelId(slackApp.bot_token, channel);
        const s = await getSession();
        const { ts } = await slackPostMessage(slackApp.bot_token, {
          channel: channelId,
          text: withSlackFooter(text, s),
        });
        const permalink = await slackGetPermalink(slackApp.bot_token, {
          channel: channelId,
          ts,
        }).catch(() => null);
        return ok({ channel: channelId, ts, permalink, app: slackApp.name });
      }),
    },
  ];

  const tools = [
    ...accountTools,
    ...buildSessionAgentIssueMcpTools(session, app),

    // ── Git ────────────────────────────────────────────────────────────────

    {
      name: 'GitPull',
      description: 'Pull latest changes from the remote branch into the current worktree.',
      schema: {},
      handler: async () => {
        if (!session?.remote_branch) return ok({ message: 'No remote branch to pull.' });
        const result = await gitPull(absoluteWorktreePath, session.remote_branch, await getToken());
        return ok(result);
      },
    },

    {
      name: 'GitPush',
      description:
        'Push a branch to origin and set upstream. Call only after any `git commit` in this turn has finished (do not invoke in parallel with commit). For normal pushes, omit all parameters. Use force: "lease" after a rebase (--force-with-lease). Use force: "force" or a non-session branch to open the Push modal for user confirmation before pushing.',
      schema: {
        branch: z
          .string()
          .optional()
          .describe(
            'Branch to push (defaults to current session branch). Specifying a different branch opens the Push modal for user confirmation.'
          ),
        force: z
          .enum(['lease', 'force'])
          .optional()
          .describe(
            '"lease" = --force-with-lease (safe, use after rebase); "force" = --force (destructive, opens the Push modal for user confirmation)'
          ),
      },
      handler: async ({ branch, force } = {}) => {
        const localErr = await requireGitHubRepo();
        if (localErr) return localErr;
        if (!session.auto_push) {
          return ok({
            message:
              'Auto-push is disabled. Changes have been committed locally. The user can push manually or enable auto-push using the controls at the bottom of the chat. Call PrUpsert with an appropriate title and description — it saves them to the session even when auto-push is off.',
          });
        }

        const freshSession = await getSession();
        const sessionBranch = freshSession.remote_branch || freshSession.local_branch;
        const isPureForce = force === 'force';
        const isNonSessionBranch =
          branch && branch !== sessionBranch && branch !== freshSession.local_branch;

        if (isPureForce || isNonSessionBranch) {
          app.service('sessions').emit('push:request', {
            sessionId: session.id,
            branch: branch || sessionBranch,
            forceMode: force || null,
          });
          return ok({
            message:
              'The Push modal has been opened with your settings. Please review and confirm the push in the UI.',
          });
        }

        let result;
        try {
          result = await gitPush(absoluteWorktreePath, await getToken(), {
            force: force === 'lease',
            ...(sessionBranch ? { branch: sessionBranch } : {}),
          });
        } catch (err) {
          if (err.rejected) return fail(err.message);
          throw err;
        }
        await patchSession({ remote_branch: result.branch });
        if (freshSession?.pr_status === 'merged') {
          return ok({
            ...result,
            hint: 'The previous PR for this session has been merged. You should: 1) call GitPull to sync with the latest changes from the remote branch and merge the base branch — resolve any conflicts, commit, and push again if needed, then 2) call PrUpsert to open a new pull request for the current changes.',
          });
        }
        return ok(result);
      },
    },

    {
      name: 'GitFetch',
      description: 'Fetch a branch from origin without modifying the working tree.',
      schema: { branch: z.string().describe('Branch name to fetch') },
      handler: async ({ branch }) => {
        const result = await gitFetch(absoluteWorktreePath, await getToken(), branch);
        return ok(result);
      },
    },

    // ── PR info ────────────────────────────────────────────────────────────

    createCurrentSessionInfoTool(getSession),

    {
      name: 'UpdateSession',
      description:
        'Rename the session in the UI (database only, no GitHub). Use when no pull request is intended yet. Title and PR description for shipping work come from PrUpsert.',
      schema: {
        label: z.string().describe('Session label / title'),
      },
      handler: async ({ label }) => {
        await patchSession({ label });
        return ok({ message: 'Session label updated.' });
      },
    },

    {
      name: 'PrRead',
      description: 'Get the current PR info: URL, number, branch, title, and description.',
      schema: {},
      handler: async () => {
        const result = {
          pr_url: session?.pr_url ?? null,
          pr_number: session?.pr_number ?? null,
          branch: session?.remote_branch || session?.local_branch || null,
          title: null,
          description: null,
        };
        if (!result.pr_url) {
          result.message =
            'No pull request exists yet. Push your changes first with GitPush, then create one with PrUpsert.';
          return ok(result);
        }
        const token = await getToken();
        if (token && session.pr_number) {
          const pr = await getOpenPRByNumber(token, session.repo_full_name, session.pr_number);
          result.title = pr.title;
          result.description = splitPrBody(pr.body).baguetteContent;
        }
        return ok(result);
      },
    },

    {
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
    },

    // ── PR comments & review ───────────────────────────────────────────────

    {
      name: 'PrComments',
      description: 'List PR conversation comments and inline review comments on the diff.',
      schema: {},
      handler: async () => {
        const session = await getSession();
        if (!session?.pr_number) {
          return fail(
            'No pull request associated with this session. Create one first with PrUpsert.'
          );
        }
        const result = await getPRComments(
          await getToken(),
          session.repo_full_name,
          session.pr_number
        );
        return ok(result);
      },
    },

    {
      name: 'PrMarkCommentViewed',
      description:
        'Mark a PR comment as viewed by adding a 👀 eyes reaction on GitHub. Viewed comments are excluded from future PrComments results. Use the comment id from PrComments output.',
      schema: {
        commentId: z.number().int().describe('Comment ID from PrComments'),
        commentType: z
          .enum(['issue', 'review'])
          .describe(
            '"issue" for conversation thread comments, "review" for inline review comments'
          ),
      },
      handler: async ({ commentId, commentType }) => {
        const session = await getSession();
        if (!session?.pr_number) return fail('No pull request associated with this session.');
        const result = await addReactionToComment(
          await getToken(),
          session.repo_full_name,
          commentId,
          commentType
        );
        return ok({ reactionId: result.id, content: result.content });
      },
    },

    {
      name: 'PrComment',
      description:
        'Post a comment on the pull request. Omit path/line for a general PR comment; provide both to post an inline comment on a specific line.',
      schema: {
        body: z.string().describe('Comment text (markdown supported)'),
        path: z
          .string()
          .optional()
          .describe('File path for an inline comment (relative to repo root)'),
        line: z.coerce
          .number()
          .int()
          .optional()
          .describe('Line number in the file for an inline comment (integer)'),
        side: z
          .enum(['LEFT', 'RIGHT'])
          .optional()
          .describe(
            'Which side of the diff: RIGHT for added/context lines (new file), LEFT for deleted lines (old file). Defaults to RIGHT.'
          ),
      },
      handler: async ({ body, path: filePath, line, side }) => {
        const session = await getSession();
        if (!session?.pr_number) return fail('No pull request associated with this session.');
        const token = await getToken();
        const bodyWithHeader = withSessionHeader(body, session);
        if (filePath && line) {
          const { stdout: commitId } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
            cwd: absoluteWorktreePath,
          });
          const comment = await createPRLineComment(
            token,
            session.repo_full_name,
            session.pr_number,
            {
              body: bodyWithHeader,
              path: filePath,
              line,
              commitId: commitId.trim(),
              side,
            }
          );
          return ok(comment);
        }
        const comment = await createPRComment(
          token,
          session.repo_full_name,
          session.pr_number,
          bodyWithHeader
        );
        return ok(comment);
      },
    },

    {
      name: 'PrReview',
      description:
        'Submit a pull request review decision. Pass inline comments via the `comments` array to have them posted as part of the review rather than as standalone comments.',
      schema: {
        event: z
          .enum(['approve', 'request-changes', 'comment'])
          .describe('Review decision: approve, request-changes, or comment'),
        body: z.string().describe('Review summary message'),
        comments: z
          .array(
            z.object({
              body: z.string().describe('Comment text (markdown supported)'),
              path: z.string().describe('File path relative to repo root'),
              line: z.coerce.number().int().describe('Line number in the file'),
              side: z
                .enum(['LEFT', 'RIGHT'])
                .optional()
                .describe(
                  'Which side of the diff: RIGHT for added/context lines (default), LEFT for deleted lines.'
                ),
            })
          )
          .optional()
          .describe('Inline comments to include as part of the review'),
      },
      handler: async ({ event, body, comments = [] }) => {
        const eventMap = {
          approve: 'APPROVE',
          'request-changes': 'REQUEST_CHANGES',
          comment: 'COMMENT',
        };
        const session = await getSession();
        if (!session?.pr_number) return fail('No pull request associated with this session.');

        let commitId = null;
        if (comments.length > 0) {
          const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
            cwd: absoluteWorktreePath,
          });
          commitId = stdout.trim();
        }

        const review = await createPRReview(
          await getToken(),
          session.repo_full_name,
          session.pr_number,
          eventMap[event],
          withSessionHeader(body, session),
          comments.map((c) => ({ ...c, body: withSessionHeader(c.body, session) })),
          commitId
        );
        return ok(review);
      },
    },

    // ── CI ─────────────────────────────────────────────────────────────────

    {
      name: 'PrWorkflows',
      description:
        'Get CI status for the PR branch: recent Actions workflow runs (with jobs, workflow path, and run metadata) and check-run rollup for the PR head (name, conclusion, required, app), matching the GitHub PR checks list.',
      schema: {},
      handler: async () => {
        const localErr = await requireGitHubRepo();
        if (localErr) return localErr;
        const session = await getSession();
        const branch = session?.remote_branch || session?.local_branch;
        if (!branch) {
          return ok({
            runs: [],
            checks: [],
            head_sha: null,
            message: 'No branch available for this session.',
          });
        }
        const { runs, checks, head_sha } = await getPRWorkflows(
          await getToken(),
          session.repo_full_name,
          branch,
          { prNumber: session.pr_number ?? undefined }
        );
        return ok({ runs, checks, head_sha });
      },
    },

    {
      name: 'PrWorkflowLogs',
      description:
        'Get logs for a workflow run. Defaults to the last 5000 bytes. When endByte is omitted, returns max(5000, bytes from startByte through EOF). When both startByte and endByte are set, the range is capped at 5000 bytes. Negative indices count from the end; do not combine a negative startByte with a non-negative endByte.',
      schema: {
        runId: z.string().describe('Workflow run ID from PrWorkflows'),
        startByte: z
          .number()
          .optional()
          .describe(
            'Start byte (0-based). Negative values count from the end. Omit both bounds for the last 5000 bytes.'
          ),
        endByte: z
          .number()
          .optional()
          .describe(
            'Inclusive end byte (optional). Negative values count from the end. When omitted, end is startByte + max(5000, bytes remaining until EOF). Must be negative if startByte is negative.'
          ),
      },
      handler: async ({ runId, startByte, endByte }) => {
        const localErr = await requireGitHubRepo();
        if (localErr) return localErr;
        const validationError = validateLogByteRange({ startByte, endByte });
        if (validationError) return fail(validationError);
        const session = await getSession();
        const result = await getPRWorkflowLogs(await getToken(), session.repo_full_name, runId, {
          startByte,
          endByte,
        });
        return ok(result);
      },
    },

    {
      name: 'ListGithubPrs',
      description:
        'List pull requests for the current repo with optional filters. When author, label, or text is provided, uses the GitHub Search API. Otherwise uses the Pulls API.',
      schema: {
        state: z
          .enum(['open', 'closed', 'all'])
          .optional()
          .describe('PR state filter (default: open)'),
        author: z.string().optional().describe('Filter by GitHub username (author of the PR)'),
        label: z.string().optional().describe('Filter by label name'),
        base: z
          .string()
          .optional()
          .describe('Filter by base branch (only used when author/label/text are not set)'),
        text: z.string().optional().describe('Full-text search query'),
      },
      handler: async ({ state = 'open', author, label, base, text } = {}) => {
        const localErr = await requireGitHubRepo();
        if (localErr) return localErr;
        const repo = await getRepo();
        if (!repo?.full_name) return fail('No repo linked to this session.');
        try {
          const prs = await listRepoPRs(await getToken(), repo.full_name, {
            state,
            author,
            label,
            base,
            text,
          });
          return ok({ prs });
        } catch (err) {
          return fail(err.message);
        }
      },
    },

    {
      name: 'GetGithubPr',
      description:
        'Get full details for a single pull request by number, including head/base branch names, body, labels, draft status, and timestamps.',
      schema: {
        pr_number: z.number().int().describe('Pull request number'),
      },
      handler: async ({ pr_number } = {}) => {
        const localErr = await requireGitHubRepo();
        if (localErr) return localErr;
        const repo = await getRepo();
        if (!repo?.full_name) return fail('No repo linked to this session.');
        try {
          const pr = await getOpenPRByNumber(await getToken(), repo.full_name, pr_number);
          return ok({ pr });
        } catch (err) {
          return fail(err.message);
        }
      },
    },

    {
      name: 'AddGithubLabel',
      description:
        'Add one or more labels to a pull request. Labels must already exist on the repo.',
      schema: {
        pr_number: z.number().int().describe('Pull request number'),
        labels: z.array(z.string()).min(1).describe('Label names to add'),
      },
      handler: async ({ pr_number, labels } = {}) => {
        const localErr = await requireGitHubRepo();
        if (localErr) return localErr;
        const repo = await getRepo();
        if (!repo?.full_name) return fail('No repo linked to this session.');
        try {
          const all_labels = await addLabelsToPR(
            await getToken(),
            repo.full_name,
            pr_number,
            labels
          );
          return ok({ labels: all_labels });
        } catch (err) {
          return fail(err.message);
        }
      },
    },

    {
      name: 'ListGithubTags',
      description: 'List git tags for the current repo (most recent 50).',
      schema: {},
      handler: async () => {
        const localErr = await requireGitHubRepo();
        if (localErr) return localErr;
        const repo = await getRepo();
        if (!repo?.full_name) return fail('No repo linked to this session.');
        try {
          const tags = await listRepoTags(await getToken(), repo.full_name);
          return ok({ tags });
        } catch (err) {
          return fail(err.message);
        }
      },
    },

    // ── Project commands ───────────────────────────────────────────────────

    {
      name: 'ListProjectCommands',
      description:
        'List available project commands defined in .baguette.yaml (tests, linters, migrations, etc.). Commands with attach: false in config include that field; such tasks cannot be run with attach: true via RunProjectCommand (use detached mode and ReadTaskOutput or TaskStatus).',
      schema: {},
      handler: async () => {
        let cfg;
        try {
          cfg = await loadBaguetteConfig(session.worktree_path);
          if (cfg?.error) throw new Error(cfg.error);
        } catch (err) {
          return fail(err.message);
        }
        if (!cfg) {
          return ok({
            commands: [],
            message:
              'No Baguette config found (.baguette.yaml). Run ConfigRepoPrompt and follow the instructions.',
          });
        }
        let commands;
        try {
          commands = getAvailableCommands(cfg).filter(
            (c) =>
              c && typeof c.label === 'string' && (typeof c.run === 'string' || c.type === 'docker')
          );
        } catch (err) {
          if (err instanceof BaguetteConfigError) return fail(err.message);
          throw err;
        }
        return ok({ commands });
      },
    },

    {
      name: 'RunProjectCommand',
      description:
        'Run a project command by its label from .baguette.yaml (e.g. "Run tests"). Always use this instead of running scripts directly. Pass args to scope execution: a file path, a test name pattern, or any flag the underlying runner supports (e.g. ["src/foo.test.js"], ["--grep", "my test"], ["-k", "my_test"]). By default runs detached: returns a taskId immediately so you can check logs with ReadTaskOutput or stop the task with KillTask. Pass attach: true to wait for the command to finish and get the full output inline. If ListProjectCommands listed attach: false for that label, attach: true is rejected — run detached and poll logs with ReadTaskOutput or TaskStatus.',
      schema: {
        label: z.string().describe('Command label exactly as returned by ListProjectCommands'),
        args: z
          .array(z.string())
          .optional()
          .describe(
            'Extra arguments appended to the command (e.g. a test file path, name pattern, or CLI flag)'
          ),
        env: z
          .record(z.string())
          .optional()
          .describe(
            'Extra environment variables to set for this command run, merged on top of session env'
          ),
        attach: z
          .boolean()
          .optional()
          .describe(
            'If true, wait for the command to finish and return exitCode/stdoutLines/stderrLines inline. Default false (detached): returns taskId immediately. Cannot be true when the command has attach: false in config (see ListProjectCommands).'
          ),
      },
      handler: async ({ label, args = [], env: extraEnv, attach = false }) => {
        let tasks;
        try {
          const cfg = await loadBaguetteConfig(session.worktree_path);
          if (cfg?.error) throw new Error(cfg.error);
          tasks = cfg ? getAvailableTasks(cfg) : null;
        } catch (err) {
          return fail(err.message);
        }

        if (!tasks) return fail('Baguette config not found');

        if (!tasks[label]) {
          return fail(`Unknown command label: ${label}`);
        }

        const taskDef = tasks[label];
        if (attach && taskDef.attach === false) {
          return fail(
            `Task "${label}" has attach: false in Baguette config; run without attach and poll with ReadTaskOutput or TaskStatus.`
          );
        }

        if (!attach) {
          try {
            const task = await app.service('tasks').create(
              {
                session_id: session.id,
                task_key: label,
                args,
                extra_env: extraEnv,
              },
              { user: { id: session.user_id } }
            );
            return ok({ taskId: task.id, label: task.label, status: task.status });
          } catch (err) {
            return fail(err.message);
          }
        }

        let stdout = '';
        let stderr = '';

        return new Promise((resolve) => {
          app
            .service('tasks')
            .create(
              {
                session_id: session.id,
                task_key: label,
                args,
                extra_env: extraEnv,
                onLog: (id, stream, data) => {
                  if (stream === 'stdout') stdout += data;
                  else stderr += data;
                },
                onExit: (id, exitCode) =>
                  resolve(
                    ok({
                      exitCode,
                      stdoutLines: streamToLines(stdout),
                      stderrLines: streamToLines(stderr),
                    })
                  ),
              },
              { user: { id: session.user_id } }
            )
            .catch((err) => resolve(fail(err.message)));
        });
      },
    },

    // ── Task lifecycle ──────────────────────────────────────────────────────

    {
      name: 'ListRunningTasks',
      description:
        'List currently running baguette tasks for this session, including their labels and assigned ports.',
      schema: {},
      handler: async () => {
        const tasks = app.service('tasks').filterTasks({
          sessionIds: new Set([session.id]),
          status: 'running',
        });
        return ok({
          tasks: tasks.map((t) => ({ id: t.id, label: t.label, status: t.status, ports: t.ports })),
        });
      },
    },

    {
      name: 'TaskStatus',
      description:
        'Get the status of a baguette task by its ID, including whether each assigned port is currently listening. Useful for checking if a dev server is ready after starting it with RunProjectCommand.',
      schema: {
        taskId: z.number().int().describe('Task ID from RunProjectCommand or ListRunningTasks'),
      },
      handler: async ({ taskId }) => {
        const task = app.service('tasks').getTask(taskId);
        if (!task) return fail(`Task ${taskId} not found`);
        if (task.session_id !== session.id)
          return fail(`Task ${taskId} does not belong to this session`);
        const portEntries = Object.entries(task.ports);
        const portStatus = {};
        await Promise.all(
          portEntries.map(async ([envVar, port]) => {
            portStatus[envVar] = { port, listening: await isPortListening(port) };
          })
        );
        return ok({
          taskId: task.id,
          label: task.label,
          status: task.status,
          exit_code: task.exit_code,
          ports: portStatus,
        });
      },
    },

    {
      name: 'KillTask',
      description: 'Kill a running baguette task by its ID.',
      schema: { taskId: z.number().int().describe('Task ID from ListRunningTasks') },
      handler: async ({ taskId }) => {
        const task = app.service('tasks').getTask(taskId);
        if (!task) return fail(`Task ${taskId} not found`);
        if (task.session_id !== session.id)
          return fail(`Task ${taskId} does not belong to this session`);
        const killed = await task.kill();
        return ok({ killed, taskId });
      },
    },

    {
      name: 'ReadTaskOutput',
      description: `Read the log output of a running or exited baguette task. Defaults to the last ${DEFAULT_LOG_BYTES} bytes. When endByte is omitted, returns max(5000, bytes from startByte through EOF). When both startByte and endByte are set, the range is capped at ${MAX_LOG_RANGE_BYTES} bytes. Negative indices count from the end; do not combine a negative startByte with a non-negative endByte.`,
      schema: {
        taskId: z.number().int().describe('Task ID from ListRunningTasks'),
        startByte: z
          .number()
          .optional()
          .describe(
            'Start byte (0-based). Negative values count from the end. Omit both bounds for the last 5000 bytes.'
          ),
        endByte: z
          .number()
          .optional()
          .describe(
            'Inclusive end byte (optional). Negative values count from the end. When omitted, end is startByte + max(5000, bytes remaining until EOF). Must be negative if startByte is negative.'
          ),
      },
      handler: async ({ taskId, startByte, endByte }) => {
        const task = app.service('tasks').getTask(taskId);
        if (!task) return fail(`Task ${taskId} not found`);
        if (task.session_id !== session.id)
          return fail(`Task ${taskId} does not belong to this session`);
        const validationError = validateLogByteRange({ startByte, endByte });
        if (validationError) return fail(validationError);
        try {
          const {
            log,
            totalBytes,
            startByte: actualStart,
            endByte: actualEnd,
          } = sliceByteRange(task.getLogs(), { startByte, endByte });
          return ok({
            taskId,
            totalBytes,
            startByte: actualStart,
            endByte: actualEnd,
            log,
          });
        } catch (err) {
          return fail(err.message);
        }
      },
    },

    // ── Repo config ─────────────────────────────────────────────────────────

    {
      name: 'ConfigRepoPrompt',
      description:
        'Get the onboarding instructions for configuring this repository (.baguette.yaml setup).',
      schema: {},
      handler: async () => {
        const prompt = await loadPrompt('onboarding-prompt', {});
        const interactivePrompt = await loadPrompt('onboarding-interactive-prompt');
        return ok({ prompt: [prompt, interactivePrompt].join('\n\n') });
      },
    },

    {
      name: 'ConfigRepoStart',
      description:
        'Start a new session dedicated to configuring .baguette.yaml for this repository.',
      schema: {},
      handler: async () => {
        const session = await getSession();
        const repo = await db('repos').where({ id: session.repo_id }).first();
        const prompt = await loadPrompt('onboarding-prompt', {});
        const newSession = await app.service('sessions').create(
          {
            repo_full_name: session.repo_full_name,
            base_branch: repo.default_branch,
            initial_prompt: prompt,
          },
          { provider: undefined, user: { id: session.user_id } }
        );
        const sessionPath = `/sessions/${newSession.id}`;
        return ok({
          sessionId: newSession.id,
          sessionPath,
          message: `Configuration session started: ${sessionPath}`,
        });
      },
    },

    // ── Diff display ───────────────────────────────────────────────────────

    {
      name: 'ShowDiff',
      description: 'Display the git diff for a file visually to the user in a diff viewer.',
      schema: {
        path: z.string().describe('File path (relative to worktree root) to show diff for'),
      },
      handler: async ({ path: filePath }) => {
        // Diff is fetched client-side via sessionsService.showDiff — nothing returned to agent
        return ok({ path: filePath });
      },
    },

    // ── Image upload ───────────────────────────────────────────────────────

    {
      name: 'UploadImage',
      description:
        'Upload an image so it can be embedded in the PR description or comments via a public URL. ' +
        'Provide either filePath (a path relative to the worktree root, e.g. a screenshot saved by a test or Playwright) ' +
        'or base64 + mediaType for raw image data. ' +
        'Returns a public URL and a ready-to-use markdown snippet like ![alt](url).',
      schema: {
        filePath: z
          .string()
          .optional()
          .describe('Path to the image file, relative to the worktree root'),
        base64: z
          .string()
          .optional()
          .describe('Base64-encoded image data (required when filePath is omitted)'),
        mediaType: z
          .enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
          .optional()
          .describe('MIME type of the image (required when using base64)'),
        altText: z.string().optional().describe('Alt text for the markdown image snippet'),
      },
      handler: async ({ filePath, base64, mediaType, altText = 'screenshot' }) => {
        const MEDIA_TYPE_EXT = {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/gif': '.gif',
          'image/webp': '.webp',
        };
        const EXT_MEDIA_TYPE = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
        };

        let imageBuffer;
        let ext;

        if (filePath) {
          const absPath = path.resolve(absoluteWorktreePath, filePath);
          if (
            !absPath.startsWith(absoluteWorktreePath + path.sep) &&
            absPath !== absoluteWorktreePath
          ) {
            return fail('filePath must be within the worktree');
          }
          const fileExt = path.extname(filePath).toLowerCase();
          if (!EXT_MEDIA_TYPE[fileExt]) {
            return fail(
              `Unsupported image extension: ${fileExt}. Supported: .png .jpg .jpeg .gif .webp`
            );
          }
          try {
            imageBuffer = await fs.promises.readFile(absPath);
          } catch {
            return fail(`Could not read file: ${filePath}`);
          }
          ext = fileExt;
        } else if (base64 && mediaType) {
          if (!MEDIA_TYPE_EXT[mediaType]) {
            return fail(`Unsupported mediaType: ${mediaType}`);
          }
          imageBuffer = Buffer.from(base64, 'base64');
          ext = MEDIA_TYPE_EXT[mediaType];
        } else {
          return fail('Provide either filePath or base64 + mediaType');
        }

        const imageId = `${randomUUID()}${ext}`;
        const destPath = path.join(IMAGES_DIR, imageId);
        await fs.promises.writeFile(destPath, imageBuffer);

        const url = `${PUBLIC_API_HOST}/api/images/${imageId}`;
        return ok({ url, markdown: `![${altText}](${url})` });
      },
    },

    // ── Slack ──────────────────────────────────────────────────────────────

    ...(slackApps.length ? slackTools : []),
  ];

  if (isGlobalSession(session)) {
    const excluded = new Set(GLOBAL_SESSION_EXCLUDED_MCP_TOOLS);
    return tools.filter((t) => !excluded.has(t.name));
  }
  return tools;
}

export async function buildBaguetteMcpServer(session, app) {
  const slackApps = await loadConfiguredSlackApps(app);
  const toolList = await buildBaguetteToolList(session, app, { slackApps });
  return createSdkMcpServer({
    name: 'baguette',
    tools: toolList.map(({ name, description, schema, handler }) =>
      tool(name, description, schema, handler)
    ),
  });
}

function toolListToCursorCustomTools(toolList) {
  return Object.fromEntries(
    toolList.map(({ name, description, schema, handler }) => {
      const hasSchema = Object.keys(schema).length > 0;
      const inputSchema = hasSchema ? z.toJSONSchema(z.object(schema)) : undefined;
      return [name, { description, inputSchema, execute: (args) => handler(args) }];
    })
  );
}

export async function buildCursorCustomTools(session, app) {
  const slackApps = await loadConfiguredSlackApps(app);
  const toolList = await buildBaguetteToolList(session, app, { slackApps });
  return toolListToCursorCustomTools(toolList);
}

export function buildReviewerMcpServer(session, app, turnAgent = {}) {
  const toolList = buildReviewerIssueMcpTools(session, app, turnAgent);
  return createSdkMcpServer({
    name: 'baguette',
    tools: toolList.map(({ name, description, schema, handler }) =>
      tool(name, description, schema, handler)
    ),
  });
}

export function buildReviewerCursorCustomTools(session, app, turnAgent = {}) {
  return toolListToCursorCustomTools(buildReviewerIssueMcpTools(session, app, turnAgent));
}
