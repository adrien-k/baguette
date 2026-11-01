import { test, expect } from '@playwright/test';
import { MOCK_AGENT_SUMMARY_TEXT } from '../shared/mock-agent-sdk.js';
import {
  addManualBuilderAgent,
  createLocalRepo,
  deleteAgentFromPanel,
  devLogin,
  expectMcpReadonlyComposer,
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_QUICK_TURN_SUMMARY,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PROMPT,
  MOCK_E2E_SUBAGENT_SUMMARY,
  expectComposerAgentSwitcherSections,
  openSessionAgentsPanel,
  saveE2eScreenshot,
  selectAgentInPanel,
  expectMockQuickTurnComplete,
  sendSessionChatMessage,
  sessionChatComposer,
  startMockBuilderSession,
} from './helpers.js';

const MANUAL_BUILDER_NAME = 'Manual E2E builder';
const FULL_MOCK_TURN_PROMPT = 'Exercise the mock agent for e2e';

test.describe('session agents (mock)', () => {
  test('composer switcher separates running and idle agents', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    await addManualBuilderAgent(page, MANUAL_BUILDER_NAME);
    await selectAgentInPanel(page, 'Main');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await sendSessionChatMessage(page, FULL_MOCK_TURN_PROMPT);

    const dialog = await expectComposerAgentSwitcherSections(page);
    await expect(
      dialog.getByRole('button', { name: new RegExp(MANUAL_BUILDER_NAME) })
    ).toBeVisible();

    await saveE2eScreenshot(page, 'composer-agent-switcher-sections.png');

    await page.keyboard.press('Escape');
    await expect(page.getByText(MOCK_AGENT_SUMMARY_TEXT)).toBeVisible({ timeout: 120_000 });
  });

  test('manual builder, MCP subagent, readonly chat, and deletion', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    await addManualBuilderAgent(page, MANUAL_BUILDER_NAME);
    await selectAgentInPanel(page, MANUAL_BUILDER_NAME);
    await sendSessionChatMessage(page, MOCK_E2E_QUICK_TURN_PROMPT);
    await expect(page.getByText(MOCK_E2E_QUICK_TURN_SUMMARY)).toBeVisible({ timeout: 120_000 });

    await selectAgentInPanel(page, 'Main');
    await sendSessionChatMessage(page, MOCK_E2E_SUBAGENT_PROMPT);
    await expect(page.getByText(MOCK_E2E_SUBAGENT_SUMMARY)).toBeVisible({ timeout: 120_000 });

    await openSessionAgentsPanel(page);
    await expect(page.getByText('Subagents')).toBeVisible();
    await expect(page.locator('li').filter({ hasText: MOCK_E2E_SUBAGENT_NAME })).toBeVisible();

    await selectAgentInPanel(page, MOCK_E2E_SUBAGENT_NAME);
    await expectMcpReadonlyComposer(page);

    await selectAgentInPanel(page, 'Main');
    await expect(await sessionChatComposer(page)).toBeVisible();
    await expect(
      page.getByText(
        'This agent only accepts new messages via MCP. Switch to another agent to chat in'
      )
    ).toHaveCount(0);

    await deleteAgentFromPanel(page, MOCK_E2E_SUBAGENT_NAME);
    await expect(page.locator('li').filter({ hasText: MOCK_E2E_SUBAGENT_NAME })).toHaveCount(0);
  });
});
