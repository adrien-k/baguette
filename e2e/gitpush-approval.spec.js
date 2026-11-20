import { test, expect } from './fixtures.js';
import {
  MOCK_E2E_GITPUSH_FORCE_PROMPT,
  MOCK_E2E_GITPUSH_PROMPT,
  MOCK_E2E_GITPUSH_REASON,
  MOCK_E2E_GITPUSH_SESSION_PROMPT,
  MOCK_E2E_GITPUSH_SESSION_SUMMARY,
  MOCK_E2E_GITPUSH_SUMMARY,
  MOCK_E2E_QUICK_TURN_PROMPT,
} from '../shared/mock-agent-sdk.js';
import {
  devLogin,
  e2eSessionWorktreePath,
  gitSha,
  listSessionAgentsForPage,
  parseSessionIdFromUrl,
  saveE2eLocatorScreenshot,
  saveE2eScreenshot,
  seedGitPushOriginRepo,
  settleForScreenshot,
  startMockBuilderSession,
} from './helpers.js';

const WIDE_VIEWPORT = { width: 1280, height: 800 };

const AUTO_PUSH_OFF_CONFIRM =
  /Confirmation is required because[\s\S]*auto-push is off[\s\S]*one-time manual push/;

/** The Push modal overlay (MODAL_OVERLAY_CLASS includes bg-scrim; only modals use it). */
function pushModal(page) {
  return page.locator('.bg-scrim', { hasText: 'Agent wants to push' });
}

/** GitPush tool-call card in the session chat (locator screenshot target). */
function gitPushChatCard(page) {
  return page
    .locator('.rounded-lg.border')
    .filter({ has: page.getByText('GitPush', { exact: true }) })
    .first();
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

async function waitForGitPushChatCard(page, summaryText) {
  await waitForAgentTurnSettled(page);
  await expect
    .poll(
      async () => {
        if (
          (await page.getByText(summaryText).count()) > 0 &&
          (await gitPushChatCard(page).count()) > 0
        ) {
          return true;
        }
        await page.reload();
        await page
          .getByPlaceholder(/Message /)
          .waitFor({ state: 'visible', timeout: 30_000 })
          .catch(() => {});
        return (
          (await page.getByText(summaryText).count()) > 0 &&
          (await gitPushChatCard(page).count()) > 0
        );
      },
      { timeout: 120_000, intervals: [2_000, 3_000] }
    )
    .toBe(true);
  const card = gitPushChatCard(page);
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

async function waitForGitPushCanceledOnCard(page, summaryText) {
  let card = await waitForGitPushChatCard(page, summaryText);
  await expect
    .poll(
      async () => {
        card = gitPushChatCard(page);
        if ((await card.getByText('canceled', { exact: true }).count()) > 0) return true;
        if ((await card.getByText(/Waiting for the user/).count()) === 0) {
          return (await card.getByText('canceled', { exact: true }).count()) > 0;
        }
        await page.reload();
        await page
          .getByPlaceholder(/Message /)
          .waitFor({ state: 'visible', timeout: 30_000 })
          .catch(() => {});
        return false;
      },
      { timeout: 120_000, intervals: [1_500, 2_500] }
    )
    .toBe(true);
  return gitPushChatCard(page);
}

test.describe('GitPush approval flow', () => {
  test('auto-push off: session-branch push asks for one-time confirmation, cancel shows chat card', async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await stubRepoBranches(page);
    await devLogin(page);
    await grantFakeGithubToken(page);

    const { repoId } = await seedGitPushOriginRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    const sessionId = parseSessionIdFromUrl(page.url());
    expect(sessionId).toBeTruthy();
    await waitForAgentTurnSettled(page);

    const patched = await page.request.patch(`/api/sessions/${sessionId}`, {
      data: { auto_push: false },
    });
    expect(patched.ok()).toBe(true);

    const composer = page.getByPlaceholder(/Message /);
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(MOCK_E2E_GITPUSH_SESSION_PROMPT);
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    const modal = pushModal(page);
    await expect(modal).toBeVisible({ timeout: 120_000 });
    await expect(modal.getByText(MOCK_E2E_GITPUSH_REASON)).toBeVisible();
    await expect(modal.getByText(AUTO_PUSH_OFF_CONFIRM)).toBeVisible();
    await expect(modal.getByText(/^origin\//)).toBeVisible();
    const originBranchLine = (await modal.getByText(/^origin\//).innerText()).trim();
    expect(originBranchLine).toBeTruthy();
    expect(originBranchLine).not.toBe('origin/development');
    await expect(modal.getByText(/overwrites remote history/)).toHaveCount(0);

    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'gitpush-session-branch-modal-autopush-off.png');

    const cardWithReason = gitPushChatCard(page);
    await expect(cardWithReason.getByText(AUTO_PUSH_OFF_CONFIRM)).toBeVisible();
    await expect(cardWithReason.getByText('approval requested', { exact: true })).toBeVisible();
    await modal.evaluate((el) => {
      el.style.visibility = 'hidden';
    });
    await saveE2eLocatorScreenshot(
      cardWithReason,
      'gitpush-session-branch-chat-card-autopush-off.png'
    );
    await modal.evaluate((el) => {
      el.style.visibility = 'visible';
    });

    await modal.getByRole('button', { name: 'Reject' }).click();
    await expect(modal).toHaveCount(0);

    const card = await waitForGitPushCanceledOnCard(page, MOCK_E2E_GITPUSH_SESSION_SUMMARY);
    await expect(card.getByText('canceled', { exact: true })).toBeVisible();
  });

  test('development target: source → origin line, approving pushes to origin', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await stubRepoBranches(page);
    await devLogin(page);
    await grantFakeGithubToken(page);

    const { repoId, originPath } = await seedGitPushOriginRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_GITPUSH_PROMPT);
    const sessionId = parseSessionIdFromUrl(page.url());
    expect(sessionId).toBeTruthy();

    const modal = pushModal(page);
    await expect(modal).toBeVisible({ timeout: 120_000 });
    await expect(modal.getByText(MOCK_E2E_GITPUSH_REASON)).toBeVisible();
    await expect(modal.getByText('origin/development', { exact: true })).toBeVisible();
    await expect(modal.getByText(/local .*→ origin\/development/)).toBeVisible();
    await expect(modal.getByText(/overwrites remote history/)).toHaveCount(0);
    await expect(modal.getByText(/create the PR/)).toHaveCount(0);
    await expect(modal.getByText('Create PR if it does not exist')).toHaveCount(0);
    await expect(modal.getByRole('checkbox')).toHaveCount(0);

    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'gitpush-development-target-modal.png');

    await modal.getByRole('button', { name: 'Accept', exact: true }).click();

    await expect(page.getByText('Pushed successfully')).toBeVisible({ timeout: 30_000 });
    await expect(modal).toHaveCount(0);

    const [originSha, headSha] = await Promise.all([
      gitSha(originPath, 'development'),
      gitSha(await e2eSessionWorktreePath(sessionId), 'HEAD'),
    ]);
    expect(originSha).toBe(headSha);

    const sessionAfter = await page.request.get(`/api/sessions/${sessionId}`).then((r) => r.json());
    expect(sessionAfter.remote_branch).toBeTruthy();
    expect(sessionAfter.remote_branch).not.toBe('development');

    const card = await waitForGitPushChatCard(page, MOCK_E2E_GITPUSH_SUMMARY);
    await expect(card.getByText('development', { exact: true })).toBeVisible();
    await expect(card.getByText('pushed', { exact: true })).toBeVisible({ timeout: 60_000 });

    await settleForScreenshot(page);
    await saveE2eLocatorScreenshot(card, 'gitpush-development-target-chat-card.png');
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
    const sessionId = parseSessionIdFromUrl(page.url());
    expect(sessionId).toBeTruthy();

    const modal = pushModal(page);
    await expect(modal).toBeVisible({ timeout: 120_000 });
    await expect(modal.getByText(MOCK_E2E_GITPUSH_REASON)).toBeVisible();
    await expect(modal.getByText(/--force\s*overwrites remote history/)).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
    await expect(modal.getByText(AUTO_PUSH_OFF_CONFIRM)).toHaveCount(0);
    await expect(modal.getByText('Create PR if it does not exist')).toHaveCount(0);
    await expect(modal.getByRole('checkbox')).toHaveCount(0);

    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'gitpush-force-approval-modal.png');

    await modal.getByRole('button', { name: 'Reject' }).click();
    await expect(modal).toHaveCount(0);

    const card = await waitForGitPushCanceledOnCard(page, MOCK_E2E_GITPUSH_SUMMARY);
    await expect(page.getByText('GitPush', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(card.getByText('canceled', { exact: true })).toBeVisible();
    await expect(page.getByText('approval requested', { exact: true })).toHaveCount(0);
    await expect(page.getByText('--force', { exact: true }).first()).toBeVisible();

    await settleForScreenshot(page);
    await saveE2eLocatorScreenshot(card, 'gitpush-force-chat-card.png');

    // Canceled approval → development untouched
    const developmentAfter = await gitSha(originPath, 'development');
    expect(developmentAfter).toBe(developmentBefore);
  });
});
