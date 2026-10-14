import { test, expect } from '@playwright/test';
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
  openSessionAgentsPanel,
  selectAgentInPanel,
  expectMockQuickTurnComplete,
  sendSessionChatMessage,
  sessionChatComposer,
  startMockBuilderSession,
} from './helpers.js';

const MANUAL_BUILDER_NAME = 'Manual E2E builder';

test.describe('session agents (mock)', () => {
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
