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
  test('mobile: last-opened session auto-expands its other agents; caret toggles', async ({
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

    // Back to the mobile list: the builder row is always visible and the
    // last-opened session auto-expands its other agents.
    await page.locator('main a[href^="/repos/"]').first().click();
    const builderRow = sessionAgentTreeRow(page, 'Builder');
    const subagentRow = sessionAgentTreeRow(page, MOCK_E2E_SUBAGENT_NAME);
    await expect(builderRow).toBeVisible({ timeout: 30_000 });
    await expect(subagentRow).toBeVisible();

    // The caret collapses the other agents (the builder row stays) and re-expands them.
    const toggle = page.getByTestId('agent-tree-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(subagentRow).toBeHidden();
    await expect(builderRow).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(subagentRow).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test.describe('desktop viewport', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('builder row always visible, other agents collapsed by default', async ({ page }) => {
      await devLogin(page);

      const repoId = await createLocalRepo(page);
      await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
      await expectMockQuickTurnComplete(page);

      // Spawn an MCP subagent from the primary builder.
      await sendSessionChatMessage(page, MOCK_E2E_SUBAGENT_PROMPT);
      await expect(page.getByText(MOCK_E2E_SUBAGENT_SUMMARY)).toBeVisible({ timeout: 120_000 });

      // Leave the session (nothing selected): every entry shows its builder row,
      // but the other agents stay collapsed behind the caret.
      await page.goto(`/repos/${repoId}`);
      const builderRow = sessionAgentTreeRow(page, 'Builder');
      await expect(builderRow).toBeVisible({ timeout: 30_000 });
      const subagentRow = sessionAgentTreeRow(page, MOCK_E2E_SUBAGENT_NAME);
      await expect(subagentRow).toBeHidden();

      // The caret expands the other agents without selecting the session.
      const toggle = page.getByTestId('agent-tree-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(subagentRow).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
