import { test, expect } from './fixtures.js';
import {
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PROMPT,
  MOCK_E2E_SUBAGENT_SUMMARY,
} from '../shared/mock-agent-sdk.js';
import {
  addManualBuilderAgent,
  agentTreePinButton,
  clickAgentTreePin,
  createLocalRepo,
  currentSessionSidebarEntry,
  devLogin,
  expectMockQuickTurnComplete,
  fetchSessionForPage,
  hoverAgentTreeRow,
  saveE2eLocatorScreenshot,
  saveE2eScreenshot,
  selectAgentViaComposer,
  sendSessionChatMessage,
  sessionAgentTreeRow,
  sessionChatComposer,
  sessionChatUrlWithoutAgentQuery,
  settleForScreenshot,
  startMockBuilderSession,
} from './helpers.js';

const PINNED_BUILDER_NAME = 'Pinned E2E builder';
const OTHER_BUILDER_NAME = 'Other E2E builder';

const PRIMARY_BUILDER_TOOLTIP_DEFAULT =
  'This session’s primary builder. Messages sent without picking an agent are delivered here by default.';

test.describe('pinned session agents (mock)', () => {
  test('add builder pins the new agent and selects its chat', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const pinnedName = await addManualBuilderAgent(page, PINNED_BUILDER_NAME);
    const pinnedRow = sessionAgentTreeRow(page, pinnedName);
    await expect(pinnedRow).toHaveAttribute('data-selected', 'true');
    await hoverAgentTreeRow(page, pinnedName);
    await expect(agentTreePinButton(page, pinnedName)).toHaveAttribute('aria-pressed', 'true');

    const session = await fetchSessionForPage(page);
    const agentsRes = await page.request.get('/api/agents', {
      params: { session_id: session.id, $limit: 100 },
    });
    const agents = (await agentsRes.json()).data ?? [];
    const pinnedAgent = agents.find((a) => a.name === pinnedName);
    expect(pinnedAgent).toBeTruthy();
    expect(session.pinned_agent_id).toBe(pinnedAgent.id);

    await settleForScreenshot(page);
    await saveE2eLocatorScreenshot(
      await currentSessionSidebarEntry(page),
      'pinned-agent-after-add-builder.png'
    );
  });

  test('reload without agent query opens the pinned builder', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const pinnedName = await addManualBuilderAgent(page, PINNED_BUILDER_NAME);
    await selectAgentViaComposer(page, 'Builder');

    const plainUrl = sessionChatUrlWithoutAgentQuery(page);
    await page.goto(plainUrl);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();

    const pinnedRow = sessionAgentTreeRow(page, pinnedName);
    await expect(pinnedRow).toHaveAttribute('data-selected', 'true', { timeout: 30_000 });
    await expect(await sessionChatComposer(page)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('agent')).toBeNull();
  });

  test('collapsed tree still shows the pinned agent', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const pinnedName = await addManualBuilderAgent(page, PINNED_BUILDER_NAME);

    await selectAgentViaComposer(page, 'Builder');
    await sendSessionChatMessage(page, MOCK_E2E_SUBAGENT_PROMPT);
    await expect(page.getByText(MOCK_E2E_SUBAGENT_SUMMARY)).toBeVisible({ timeout: 120_000 });

    const otherName = await addManualBuilderAgent(page, OTHER_BUILDER_NAME);
    await clickAgentTreePin(page, pinnedName);
    await selectAgentViaComposer(page, 'Builder');

    const sidebar = await currentSessionSidebarEntry(page);
    const toggle = sidebar.getByTestId('agent-tree-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await expect(sessionAgentTreeRow(page, pinnedName)).toBeVisible();
    await expect(sessionAgentTreeRow(page, otherName)).toHaveCount(0);
    await expect(sessionAgentTreeRow(page, MOCK_E2E_SUBAGENT_NAME)).toHaveCount(0);

    await settleForScreenshot(page);
    await saveE2eLocatorScreenshot(sidebar, 'pinned-agent-tree-collapsed.png');
  });

  test('primary builder name shows default-routing tooltip', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const builderRow = sessionAgentTreeRow(page, 'Builder');
    await builderRow.getByLabel('Primary builder', { exact: true }).hover();
    await expect(page.getByText(PRIMARY_BUILDER_TOOLTIP_DEFAULT, { exact: true })).toBeVisible();

    await settleForScreenshot(page);
    await saveE2eLocatorScreenshot(
      await currentSessionSidebarEntry(page),
      'primary-builder-tooltip.png'
    );
  });

  test('toggle pin updates default chat on reload', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const manualName = await addManualBuilderAgent(page, OTHER_BUILDER_NAME);
    await selectAgentViaComposer(page, 'Builder');
    // Add builder auto-pins — unpin, then pin again to exercise the control.
    await clickAgentTreePin(page, manualName);
    await expect.poll(async () => (await fetchSessionForPage(page)).pinned_agent_id).toBeNull();
    await clickAgentTreePin(page, manualName);

    const sessionBefore = await fetchSessionForPage(page);
    const agentsRes = await page.request.get('/api/agents', {
      params: { session_id: sessionBefore.id, $limit: 100 },
    });
    const agents = (await agentsRes.json()).data ?? [];
    const manualAgent = agents.find((a) => a.name === manualName);
    expect(sessionBefore.pinned_agent_id).toBe(manualAgent.id);

    await page.goto(sessionChatUrlWithoutAgentQuery(page));
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(sessionAgentTreeRow(page, manualName)).toHaveAttribute('data-selected', 'true', {
      timeout: 30_000,
    });

    await selectAgentViaComposer(page, 'Builder');
    await clickAgentTreePin(page, manualName);
    await expect.poll(async () => (await fetchSessionForPage(page)).pinned_agent_id).toBeNull();

    await page.goto(sessionChatUrlWithoutAgentQuery(page));
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(sessionAgentTreeRow(page, 'Builder')).toHaveAttribute('data-selected', 'true', {
      timeout: 30_000,
    });

    await hoverAgentTreeRow(page, manualName);
    await expect(agentTreePinButton(page, manualName)).toHaveAttribute('aria-pressed', 'false');
    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'pinned-agent-unpinned.png');
  });
});
