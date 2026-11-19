import { test, expect } from './fixtures.js';
import { titleFromPrompt } from '../shared/agent-naming.js';
import {
  createLocalRepo,
  devLogin,
  e2eNumericSessionId,
  e2eSessionRow,
  parseSessionIdFromUrl,
  saveE2eScreenshot,
  seedE2eMcpUserMessage,
  startMockBuilderSession,
} from './helpers.js';

test.describe('MCP agent message source subtitle', () => {
  test('shows linked session or external MCP configuration', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await devLogin(page);
    const repoId = await createLocalRepo(page);

    const sourcePrompt = `E2E MCP source session ${Date.now()}`;
    await startMockBuilderSession(page, repoId, sourcePrompt);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const sourceId = await e2eNumericSessionId(parseSessionIdFromUrl(page.url()));
    const sourceLabel = titleFromPrompt(sourcePrompt);
    const sourceRow = await e2eSessionRow(sourceId);
    const primary = await page.request
      .get('/api/agents', { params: { session_id: sourceId, $limit: 10 } })
      .then((r) => r.json())
      .then((body) => (body.data ?? body).find((a) => a.is_primary));

    const targetPrompt = `E2E MCP target session ${Date.now()}`;
    await page.goto(`/repos/${repoId}`);
    await startMockBuilderSession(page, repoId, targetPrompt);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const targetId = await e2eNumericSessionId(parseSessionIdFromUrl(page.url()));

    await seedE2eMcpUserMessage({
      targetSessionId: targetId,
      content: 'Cross-session ping from orchestrator',
      mcpSender: {
        kind: 'session',
        session_id: sourceId,
        session_label: sourceLabel,
        repo_id: sourceRow.repo_id,
        is_global: !!sourceRow.is_global,
        agent_id: primary.id,
        agent_ref: primary.ref,
        agent_name: primary.name || 'Builder',
      },
    });

    await seedE2eMcpUserMessage({
      targetSessionId: targetId,
      content: 'External MCP steering message',
      mcpSender: {
        kind: 'external',
        label: 'Baguette MCP',
        settings_tab: 'integrations',
      },
    });

    await page.reload();
    await expect(page.getByText('MCP Agent').first()).toBeVisible({ timeout: 30_000 });

    const crossSessionBlock = page
      .locator('.border-merged\\/45')
      .filter({ hasText: 'Cross-session ping from orchestrator' });
    const sessionLink = crossSessionBlock.getByRole('link', { name: sourceLabel, exact: true });
    await expect(sessionLink).toBeVisible();
    await expect(sessionLink).toHaveAttribute('href', `/repos/${repoId}/sessions/${sourceId}`);

    const agentLink = crossSessionBlock.getByRole('link', {
      name: primary.name || 'Builder',
      exact: true,
    });
    await expect(agentLink).toBeVisible();
    await expect(agentLink).toHaveAttribute(
      'href',
      `/repos/${repoId}/sessions/${sourceId}?agent=${primary.id}&view=chat`
    );

    const externalBlock = page
      .locator('.border-merged\\/45')
      .filter({ hasText: 'External MCP steering message' });
    const settingsLink = externalBlock.getByRole('link', { name: 'Baguette MCP', exact: true });
    await expect(settingsLink).toBeVisible();
    await expect(settingsLink).toHaveAttribute('href', '/settings?tab=integrations');

    await saveE2eScreenshot(page, 'mcp-agent-source-subtitle.png', { fullPage: true });
  });
});
