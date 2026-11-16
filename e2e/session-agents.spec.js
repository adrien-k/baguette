import { test, expect } from './fixtures.js';
import { MOCK_AGENT_SUMMARY_TEXT } from '../shared/mock-agent-sdk.js';
import {
  addManualBuilderAgent,
  createLocalRepo,
  devLogin,
  expectMcpReadonlyComposer,
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_QUICK_TURN_SUMMARY,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PROMPT,
  MOCK_E2E_SUBAGENT_SUMMARY,
  expectComposerAgentSwitcherSections,
  saveE2eScreenshot,
  selectAgentInTree,
  selectAgentViaComposer,
  sessionAgentTreeRow,
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
    // The primary builder has no subagent children yet, so it has no tree row — use the composer switcher.
    await selectAgentViaComposer(page, 'Builder');
    await sendSessionChatMessage(page, FULL_MOCK_TURN_PROMPT);

    const dialog = await expectComposerAgentSwitcherSections(page);
    await expect(
      dialog.getByRole('button', { name: new RegExp(MANUAL_BUILDER_NAME) })
    ).toBeVisible();

    await saveE2eScreenshot(page, 'composer-agent-switcher-sections.png');

    await page.keyboard.press('Escape');
    await expect(page.getByText(MOCK_AGENT_SUMMARY_TEXT)).toBeVisible({ timeout: 120_000 });
  });

  test('manual builder, MCP subagent, and readonly chat', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const manualName = await addManualBuilderAgent(page, MANUAL_BUILDER_NAME);
    await selectAgentInTree(page, manualName);
    await sendSessionChatMessage(page, MOCK_E2E_QUICK_TURN_PROMPT);
    await expect(page.getByText(MOCK_E2E_QUICK_TURN_SUMMARY)).toBeVisible({ timeout: 120_000 });

    // The primary builder has no subagent children yet — switch via the composer.
    await selectAgentViaComposer(page, 'Builder');
    await sendSessionChatMessage(page, MOCK_E2E_SUBAGENT_PROMPT);
    await expect(page.getByText(MOCK_E2E_SUBAGENT_SUMMARY)).toBeVisible({ timeout: 120_000 });

    // The MCP subagent sits directly under the session row in the sidebar tree.
    await expect(sessionAgentTreeRow(page, MOCK_E2E_SUBAGENT_NAME)).toBeVisible();
    await saveE2eScreenshot(page, 'session-sidebar-agent-tree.png');

    await selectAgentInTree(page, MOCK_E2E_SUBAGENT_NAME);
    await expectMcpReadonlyComposer(page);
    await saveE2eScreenshot(page, 'mcp-readonly-composer.png');

    // The primary builder is the session row itself — switch via the composer.
    await selectAgentViaComposer(page, 'Builder');
    await expect(await sessionChatComposer(page)).toBeVisible();
    await expect(
      page.getByText(
        'This agent only accepts new messages via MCP. Switch to another agent to chat in'
      )
    ).toHaveCount(0);
  });
});
