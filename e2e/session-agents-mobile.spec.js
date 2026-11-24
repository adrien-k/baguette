import { test, expect } from './fixtures.js';
import {
  createLocalRepo,
  devLogin,
  expectMockQuickTurnComplete,
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PROMPT,
  MOCK_E2E_SUBAGENT_SUMMARY,
  sendSessionChatMessage,
  sessionAgentTreeRow,
  startMockBuilderSession,
} from './helpers.js';

// Mobile viewport: the sessions list is a full-width screen (rail below md).
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.describe('session agents in the session list (mock)', () => {
  test('mobile: session row toggle shows/hides agent tree and builder toggle nests subagents', async ({
    page,
  }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    // Mobile: the repo home is the full-width list — start the session from there.
    await page.goto(`/repos/${repoId}`);
    await page.getByRole('button', { name: 'New session' }).click();
    const composer = page.getByPlaceholder(/Ask the agent what you want to build or plan/i);
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /Mock Standard/ })).toBeVisible({
      timeout: 60_000,
    });
    await composer.fill(MOCK_E2E_QUICK_TURN_PROMPT);
    await page.getByRole('button', { name: 'Start on a new branch' }).click();
    await expect(page).toHaveURL(/\/sessions\//, { timeout: 120_000 });
    await expectMockQuickTurnComplete(page);

    // Spawn an MCP subagent from the primary builder (active by default on mobile).
    await sendSessionChatMessage(page, MOCK_E2E_SUBAGENT_PROMPT);
    await expect(page.getByText(MOCK_E2E_SUBAGENT_SUMMARY)).toBeVisible({ timeout: 120_000 });

    // Back to the mobile list: the last-opened session auto-expands its agent tree.
    await page.locator('main a[href^="/repos/"]').first().click();
    const builderRow = sessionAgentTreeRow(page, 'Builder');
    const subagentRow = sessionAgentTreeRow(page, MOCK_E2E_SUBAGENT_NAME);
    await expect(builderRow).toBeVisible({ timeout: 30_000 });
    await expect(subagentRow).toBeHidden();

    // Expand subagents nested under the builder.
    const subagentsToggle = builderRow.getByTestId('builder-subagents-toggle');
    await expect(subagentsToggle).toHaveAttribute('aria-expanded', 'false');
    await subagentsToggle.click();
    await expect(subagentRow).toBeVisible();
    await expect(subagentsToggle).toHaveAttribute('aria-expanded', 'true');

    // The session row toggle collapses and re-expands the entire agent tree on mobile.
    const sessionToggle = page.getByTestId('session-agents-toggle').first();
    await expect(sessionToggle).toHaveAttribute('aria-expanded', 'true');
    await sessionToggle.click();
    await expect(builderRow).toBeHidden();
    await expect(sessionToggle).toHaveAttribute('aria-expanded', 'false');
    await sessionToggle.click();
    await expect(builderRow).toBeVisible();
    await expect(sessionToggle).toHaveAttribute('aria-expanded', 'true');
  });

  test.describe('desktop viewport', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('agent tree only shows on the selected session', async ({ page }) => {
      await devLogin(page);

      const repoId = await createLocalRepo(page);
      await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
      await expectMockQuickTurnComplete(page);

      // Selected session shows its agent tree.
      await expect(sessionAgentTreeRow(page, 'Builder')).toBeVisible({ timeout: 30_000 });

      // Leave the session (nothing selected): no agent tree rows are shown.
      await page.goto(`/repos/${repoId}`);
      await expect(page.getByTestId('mini-session-entry').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('session-agent-tree')).toHaveCount(0);
    });
  });
});
