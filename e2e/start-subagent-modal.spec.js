import { test, expect } from './fixtures.js';
import { titleFromPrompt } from '../shared/agent-naming.js';
import {
  MOCK_E2E_QUICK_TURN_PROMPT,
  confirmStartSubagentModal,
  createLocalRepo,
  devLogin,
  expectMockQuickTurnComplete,
  openStartSubagentModalFromComposer,
  saveE2eScreenshot,
  sessionAgentTreeRow,
  sessionChatComposer,
  settleForScreenshot,
  startMockBuilderSession,
  waitForAgentNotRunning,
} from './helpers.js';

const DRAFT_PROMPT = 'Refactor the cache layer for e2e';
const PREFILL_LABEL = titleFromPrompt(DRAFT_PROMPT);
const CUSTOM_LABEL = 'Modal E2E builder';

test.describe('add builder modal (mock)', () => {
  test('prefill, screenshots, cancel, and start', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const composer = await sessionChatComposer(page);
    await composer.fill(DRAFT_PROMPT);

    await page.getByTitle('Schedule', { exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Add builder' })).toBeVisible();
    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'start-subagent-send-menu.png');

    await page.getByRole('menuitem', { name: 'Add builder' }).click();
    await expect(page.getByRole('heading', { name: 'Add builder' })).toBeVisible();
    await expect(page.getByPlaceholder('Builder name')).toHaveValue(PREFILL_LABEL);
    await expect(page.getByLabel('Generate label')).toBeVisible();
    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'start-subagent-modal.png');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Add builder' })).toHaveCount(0);
    await expect(composer).toHaveValue(DRAFT_PROMPT);

    const startPrompt = `${CUSTOM_LABEL} ${MOCK_E2E_QUICK_TURN_PROMPT}`;
    await composer.fill(startPrompt);
    await openStartSubagentModalFromComposer(page);
    await page.getByPlaceholder('Builder name').fill(CUSTOM_LABEL);
    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'start-subagent-modal-ready.png');
    await confirmStartSubagentModal(page);

    const row = sessionAgentTreeRow(page, CUSTOM_LABEL);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await waitForAgentNotRunning(page, CUSTOM_LABEL);
  });
});
