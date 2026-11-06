import { test, expect } from '@playwright/test';
import { E2E_MCP_BEARER, startE2eMockMcpServer } from './mock-mcp-server.js';
import { createLocalRepo, devLogin, saveE2eScreenshot } from './helpers.js';

const WIDE_VIEWPORT = { width: 1280, height: 900 };
const MCP_DESCRIPTION = 'Look up fixture shapes before writing SQL.';

function addServerPanel(page) {
  return page
    .locator('.max-w-lg')
    .filter({ has: page.getByRole('heading', { name: 'Add MCP server' }) });
}

test.describe('outbound MCP servers', () => {
  let mock;

  test.beforeAll(async () => {
    mock = await startE2eMockMcpServer();
  });

  test.afterAll(async () => {
    await mock?.close();
  });

  test('tests a local mock server and overrides it on a new session', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await devLogin(page);

    await page.goto('/settings?tab=integrations');
    await expect(page.getByRole('heading', { name: 'MCP servers' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Add server' }).click();

    const panel = addServerPanel(page);
    await panel.getByPlaceholder('docs').fill('docs');
    await panel.getByPlaceholder('https://example.com/mcp').fill(mock.url);
    await panel
      .getByPlaceholder('Optional — when and why agents should use this server')
      .fill(MCP_DESCRIPTION);
    // The mock server publishes no OAuth metadata: the dialog's availability
    // probe must report that dynamic client registration is unavailable, and
    // the OAuth option falls back to a manual pre-registered client.
    await panel
      .getByText('No dynamic client registration', { exact: false })
      .waitFor({ timeout: 20_000 });
    await panel.getByText('OAuth — manual client').waitFor();
    await panel.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(panel.getByText('Authentication required')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('This server needs a bearer token or OAuth.')).toBeVisible();
    await saveE2eScreenshot(page, 'mcp-settings-needs-auth.png');

    await panel.getByText('Bearer token', { exact: true }).click();
    const bearer = panel.locator('input[type="password"]').first();
    await bearer.fill(E2E_MCP_BEARER);
    await bearer.blur();
    await panel.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(panel.getByText('Handshake succeeded')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('1 tool')).toBeVisible();
    await saveE2eScreenshot(page, 'mcp-settings-test.png');

    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel).toBeHidden();
    const saved = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'MCP servers' }) });
    await expect(saved.getByText('docs http')).toBeVisible();
    await expect(saved.getByText('Bearer token', { exact: true })).toBeVisible();
    await expect(saved.getByText(mock.url)).toBeVisible();
    await expect(saved.getByText(MCP_DESCRIPTION)).toBeVisible();
    await expect(saved.getByText(E2E_MCP_BEARER)).toHaveCount(0);
    await expect(saved.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
    await saveE2eScreenshot(page, 'mcp-settings-list.png', { fullPage: true });

    // Edit opens the same picker, preselected from the stored auth method.
    await saved.getByRole('button', { name: 'Edit' }).click();
    const editPanel = page
      .locator('.max-w-lg')
      .filter({ has: page.getByRole('heading', { name: 'Edit MCP server' }) });
    await expect(editPanel.locator('input[name="mcp-auth-method"][value="bearer"]')).toBeChecked();
    // Focusing the masked bearer field (which auto-empties it) and blurring
    // without typing must not delete the stored secret on save.
    await editPanel.locator('input[type="password"]').first().click();
    await editPanel
      .getByRole('heading', { name: 'Edit MCP server' })
      .click({ position: { x: 5, y: 5 } });
    await editPanel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editPanel).toBeHidden();
    await saved.getByRole('button', { name: 'Edit' }).click();
    await expect(editPanel.locator('input[type="password"]').first()).toHaveAttribute(
      'placeholder',
      '(change to update)'
    );
    await editPanel.getByRole('button', { name: 'Cancel' }).click();
    await expect(editPanel).toBeHidden();

    const repoId = await createLocalRepo(page);
    await page.goto(`/repos/${repoId}`);
    const composer = page.getByPlaceholder(/Ask the agent what you want to build or plan/i);
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /Mock Standard/ })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'More options' }).click();
    const moreOptions = page.locator('label').filter({ hasText: 'docs' });
    await expect(moreOptions).toBeVisible();
    await expect(moreOptions.locator('input[type="checkbox"]')).toBeChecked();
    await expect(moreOptions.getByText(MCP_DESCRIPTION)).toBeVisible();
    await moreOptions.scrollIntoViewIfNeeded();
    await saveE2eScreenshot(page, 'mcp-more-options.png');
    await moreOptions.locator('input[type="checkbox"]').uncheck();

    await composer.fill('Exercise outbound MCP settings');
    await page.getByRole('button', { name: 'Start on a new branch' }).click();
    await expect(page).toHaveURL(/\/sessions\//, { timeout: 120_000 });

    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const details = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'MCP servers', level: 2 }) })
      .last();
    const sessionServer = details.locator('label').filter({ hasText: 'docs' });
    await expect(sessionServer).toBeVisible({ timeout: 30_000 });
    await expect(sessionServer.getByText(MCP_DESCRIPTION)).toBeVisible();
    const sessionToggle = sessionServer.locator('input[type="checkbox"]');
    await expect(sessionToggle).not.toBeChecked();
    await sessionToggle.click();
    await expect(sessionToggle).toBeChecked();
    await sessionServer.scrollIntoViewIfNeeded();
    await saveE2eScreenshot(page, 'mcp-session-details.png');
  });
});
