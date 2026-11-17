import { test, expect } from './fixtures.js';
import {
  MOCK_E2E_GITPUSH_FORCE_PROMPT,
  MOCK_E2E_GITPUSH_PROMPT,
  MOCK_E2E_GITPUSH_REASON,
  MOCK_E2E_GITPUSH_SUMMARY,
  MOCK_E2E_QUICK_TURN_PROMPT,
} from '../shared/mock-agent-sdk.js';
import {
  devLogin,
  e2eSessionWorktreePath,
  gitSha,
  listSessionAgentsForPage,
  parseSessionIdFromUrl,
  saveE2eScreenshot,
  seedGitPushOriginRepo,
  startMockBuilderSession,
} from './helpers.js';

const WIDE_VIEWPORT = { width: 1280, height: 800 };

/** The Push modal overlay (MODAL_OVERLAY_CLASS includes bg-scrim; only modals use it). */
function pushModal(page) {
  return page.locator('.bg-scrim', { hasText: 'Push commits' });
}

/**
 * The dev e2e user needs a token for the server-side push to take the github
 * path; the auth extraheader is scoped to `http.https://github.com/` so the
 * fake token never reaches the local bare origin the push actually targets.
 */
async function grantFakeGithubToken(page) {
  const me = await page.request.get('/auth/me').then((r) => r.json());
  const res = await page.request.patch(`/api/users/${me.user.id}`, {
    data: { github_token: 'e2e-fake-token' },
  });
  const body = await res.text().catch(() => '');
  expect(res.ok(), `users patch failed: ${res.status()} ${body}`).toBe(true);
}

/**
 * The Push modal and the New Session branch picker load branches from the
 * GitHub API for github-mode repos. Feathers 6 custom methods POST to the
 * service root with an `X-Service-Method` header — fulfill that one call
 * locally so the e2e stays network-free and the picker lists the bare
 * origin's branches.
 */
async function stubRepoBranches(page) {
  await page.route(/\/api\/repos$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST' || req.headers()['x-service-method'] !== 'branches') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ branches: ['master', 'development'] }),
    });
  });
}

/** Poll the agents API until the builder's turn reached a terminal state (no SSE reliance). */
async function waitForAgentTurnSettled(page) {
  await expect(async () => {
    const agents = await listSessionAgentsForPage(page);
    const builder = agents.find((a) => a.agent_type === 'builder');
    expect(['completed', 'failed', 'stopped', 'approval']).toContain(builder?.status);
  }).toPass({ timeout: 120_000, intervals: [500, 1_000] });
}

test.describe('GitPush approval flow', () => {
  test('auto-push off: approval asks to bypass, approving pushes to origin', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await stubRepoBranches(page);
    await devLogin(page);
    await grantFakeGithubToken(page);

    const { repoId, originPath } = await seedGitPushOriginRepo(page);
    // Turn 1 without commits (auto-push no-ops), then disable auto-push so the
    // GitPush turn cannot race a turn-end auto-push. Wait via the agents API —
    // a fast mock turn can drop its summary's message-created SSE event in the
    // live chat view.
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    const sessionId = Number(parseSessionIdFromUrl(page.url()));
    expect(sessionId).toBeTruthy();
    await waitForAgentTurnSettled(page);

    const patched = await page.request.patch(`/api/sessions/${sessionId}`, {
      data: { auto_push: false },
    });
    expect(patched.ok()).toBe(true);

    const composer = page.getByPlaceholder(/Message /);
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(MOCK_E2E_GITPUSH_PROMPT);
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    const modal = pushModal(page);
    await expect(modal).toBeVisible({ timeout: 120_000 });
    await expect(modal.getByRole('heading', { name: 'Push commits' })).toBeVisible();
    // Agent intent + push details
    await expect(modal.getByText(MOCK_E2E_GITPUSH_REASON)).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Change selection' })).toHaveText('development');
    await expect(modal.getByText(/local .*→ origin\/development/)).toBeVisible();
    // Auto-push is off: the modal asks whether to push this once anyway
    await expect(modal.getByText(/Auto-push is off for this session/)).toBeVisible();
    // …a regular push shows no force warning…
    await expect(modal.getByText(/overwrites remote history/)).toHaveCount(0);
    // …and agent requests never offer or attempt PR creation
    await expect(modal.getByText(/create the PR/)).toHaveCount(0);
    await expect(modal.getByText('Create PR if it does not exist')).toHaveCount(0);
    await expect(modal.getByRole('checkbox')).toHaveCount(0);

    await saveE2eScreenshot(page, 'gitpush-approval-modal-autopush-off.png');

    await modal.getByRole('button', { name: 'Push', exact: true }).click();

    await expect(page.getByText('Pushed successfully')).toBeVisible({ timeout: 30_000 });
    await expect(modal).toHaveCount(0);

    // The bare origin's development branch now points at the worktree HEAD
    const [originSha, headSha] = await Promise.all([
      gitSha(originPath, 'development'),
      gitSha(await e2eSessionWorktreePath(sessionId), 'HEAD'),
    ]);
    expect(originSha).toBe(headSha);

    // One-off push to development must not retarget the session branch.
    const sessionAfter = await page.request.get(`/api/sessions/${sessionId}`).then((r) => r.json());
    expect(sessionAfter.remote_branch).toBeTruthy();
    expect(sessionAfter.remote_branch).not.toBe('development');
  });

  test('force push request: --force approval detail shown, cancel leaves the remote untouched', async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await stubRepoBranches(page);
    await devLogin(page);
    await grantFakeGithubToken(page);

    const { repoId, originPath } = await seedGitPushOriginRepo(page);
    const developmentBefore = await gitSha(originPath, 'development');

    // Session starts directly with the force request; auto-push stays on here,
    // so the modal must NOT show the auto-push bypass question.
    await startMockBuilderSession(page, repoId, MOCK_E2E_GITPUSH_FORCE_PROMPT);
    const sessionId = Number(parseSessionIdFromUrl(page.url()));
    expect(sessionId).toBeTruthy();

    const modal = pushModal(page);
    await expect(modal).toBeVisible({ timeout: 120_000 });
    await expect(modal.getByText(MOCK_E2E_GITPUSH_REASON)).toBeVisible();
    await expect(modal.getByText(/--force\s*overwrites remote history/)).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Force Push' })).toBeVisible();
    await expect(modal.getByText(/Auto-push is off for this session/)).toHaveCount(0);
    await expect(modal.getByText('Create PR if it does not exist')).toHaveCount(0);
    await expect(modal.getByRole('checkbox')).toHaveCount(0);

    await saveE2eScreenshot(page, 'gitpush-force-approval-modal.png');

    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toHaveCount(0);

    // Turn wraps up. Reload before asserting the chat card: a fast mock turn can
    // drop one message-created SSE event in the live view, and a fresh mount
    // renders the complete persisted turn deterministically.
    await waitForAgentTurnSettled(page);
    await page.reload();
    await expect(page.getByText(MOCK_E2E_GITPUSH_SUMMARY)).toBeVisible({ timeout: 60_000 });
    // Exact matches: the badge texts also appear inside the summary paragraph.
    await expect(page.getByText('GitPush', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('canceled', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('approval requested', { exact: true })).toHaveCount(0);
    await expect(page.getByText('--force', { exact: true }).first()).toBeVisible();

    await saveE2eScreenshot(page, 'gitpush-chat-block.png', { fullPage: true });

    // Canceled approval → development untouched
    const developmentAfter = await gitSha(originPath, 'development');
    expect(developmentAfter).toBe(developmentBefore);
  });
});
