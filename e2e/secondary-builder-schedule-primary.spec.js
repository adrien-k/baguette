import { test, expect } from './fixtures.js';
import {
  addIdleSecondaryBuilder,
  createLocalRepo,
  devLogin,
  expectMockQuickTurnComplete,
  fillComposerForSchedule,
  hoverAgentTreeRow,
  listQueuedMessagesForPage,
  listSessionAgentsForPage,
  MOCK_E2E_QUICK_TURN_PROMPT,
  saveE2eLocatorScreenshot,
  saveE2eScreenshot,
  scheduleComposerPreset,
  sessionAgentTreeRow,
  settleForScreenshot,
  startMockBuilderSession,
} from './helpers.js';

const SECONDARY_BUILDER_NAME = 'Schedule E2E builder';
const SCHEDULED_PROMPT = 'Follow up from secondary builder';

test.describe('secondary builder schedule and primary switch', () => {
  test('schedule targets secondary builder and set-primary control promotes it', async ({
    page,
  }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const manualName = await addIdleSecondaryBuilder(page, SECONDARY_BUILDER_NAME);

    const agents = await listSessionAgentsForPage(page);
    const secondary = agents.find((a) => a.name === manualName);
    expect(secondary?.id).toBeTruthy();
    expect(Number(secondary.is_primary)).toBe(0);

    await fillComposerForSchedule(page, SCHEDULED_PROMPT);
    await scheduleComposerPreset(page, 'Send in 30 minutes');
    await expect(page.getByText('Message scheduled')).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const rows = await listQueuedMessagesForPage(page);
          const row = rows.find(
            (r) => r.kind === 'scheduled' && String(r.message_json).includes(SCHEDULED_PROMPT)
          );
          return row?.agent_id != null ? Number(row.agent_id) : null;
        },
        { timeout: 15_000 }
      )
      .toBe(Number(secondary.id));

    const drawerToggle = page.getByRole('button', { name: /Queued & scheduled/i });
    await expect(drawerToggle).toBeVisible();
    await expect(drawerToggle).toContainText('1 scheduled');
    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'secondary-builder-scheduled-queue.png');

    const primaryBefore = agents.find((a) => Number(a.is_primary) === 1);
    expect(primaryBefore?.id).toBeTruthy();

    await hoverAgentTreeRow(page, manualName);
    const setPrimaryControl = sessionAgentTreeRow(page, manualName).getByTestId(
      'agent-tree-set-primary'
    );
    await expect(setPrimaryControl).toBeVisible();
    await setPrimaryControl.getByRole('button', { name: /Make .+ the primary builder/i }).click();

    await expect(page.getByRole('heading', { name: 'Make primary builder?' })).toBeVisible();
    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'set-primary-confirm-modal.png');

    await page.getByRole('button', { name: 'Make primary', exact: true }).click();
    await expect(page.getByText('Primary builder updated')).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(async () => {
        const nextAgents = await listSessionAgentsForPage(page);
        const promoted = nextAgents.find((a) => a.id === secondary.id);
        const demoted = nextAgents.find((a) => a.id === primaryBefore.id);
        return (
          promoted &&
          Number(promoted.is_primary) === 1 &&
          demoted &&
          Number(demoted.is_primary) === 0
        );
      })
      .toBe(true);

    await settleForScreenshot(page);
    await saveE2eLocatorScreenshot(
      page.getByTestId('session-list-rail'),
      'set-primary-after-switch.png'
    );
  });
});
