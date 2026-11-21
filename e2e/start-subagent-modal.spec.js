import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';
import { titleFromPrompt } from '../shared/agent-naming.js';
import {
  MOCK_E2E_QUICK_TURN_PROMPT,
  attachFileInAddBuilderModal,
  attachFileInChatComposer,
  addBuilderModalComposer,
  addManualBuilderAgent,
  confirmStartSubagentModal,
  createLocalRepo,
  devLogin,
  expectMockQuickTurnComplete,
  listSessionAgentsForPage,
  openAddBuilderModalFromAgentTree,
  openStartSubagentModalFromComposer,
  saveE2eScreenshot,
  sessionAgentTreeRow,
  sessionChatComposer,
  settleForScreenshot,
  startMockBuilderSession,
  waitForAgentNotRunning,
  writeE2eRepoBaguetteYaml,
} from './helpers.js';

const CHAT_ATTACHMENT_FIXTURE = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures/chat-attachment.txt'
);
const ATTACHMENT_BASENAME = 'chat-attachment.txt';
const ATTACHMENT_BODY_SNIPPET = 'Baguette e2e chat attachment fixture.';

const DRAFT_PROMPT = 'Refactor the cache layer for e2e';
const PREFILL_LABEL = titleFromPrompt(DRAFT_PROMPT);
const CUSTOM_LABEL = 'Modal E2E builder';

const LARGE_RECIPE_LABEL = 'E2E large recipe';
const LARGE_RECIPE_PROMPT = Array.from(
  { length: 24 },
  (_, i) => `Step ${i + 1}: checklist line for add-builder composer auto-grow.`
).join('\n');

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
    await expect(
      page.getByPlaceholder('Optional — leave empty to open the builder with no initial message')
    ).toHaveValue(DRAFT_PROMPT);
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

  test('carries chat file attachments into the add-builder composer', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const composer = await sessionChatComposer(page);
    const draft = `Attach for add builder ${MOCK_E2E_QUICK_TURN_PROMPT}`;
    await composer.fill(draft);
    await attachFileInChatComposer(page, CHAT_ATTACHMENT_FIXTURE);
    await expect(page.getByText(ATTACHMENT_BASENAME).first()).toBeVisible();

    await openStartSubagentModalFromComposer(page);
    const modalComposer = addBuilderModalComposer(page);
    await expect(modalComposer).toHaveValue(draft);
    const modalPickerRoot = modalComposer.locator(
      'xpath=ancestor::div[contains(@class,"flex-col")][1]'
    );
    await expect(modalPickerRoot.getByText(ATTACHMENT_BASENAME)).toBeVisible();

    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'start-subagent-modal-with-attachment.png');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Add builder' })).toHaveCount(0);
    await expect(composer).toHaveValue(draft);
    await expect(page.getByText(ATTACHMENT_BASENAME).first()).toBeVisible();
  });

  test('sends attachment on the new builder first message', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const composer = await sessionChatComposer(page);
    const prompt = `Attachment confirm ${MOCK_E2E_QUICK_TURN_PROMPT}`;
    await composer.fill(prompt);
    await attachFileInChatComposer(page, CHAT_ATTACHMENT_FIXTURE);
    await openStartSubagentModalFromComposer(page);
    await confirmStartSubagentModal(page);
    await expect(page.getByRole('heading', { name: 'Add builder' })).toHaveCount(0);
    await expect(page.getByText(ATTACHMENT_BODY_SNIPPET)).toBeVisible({ timeout: 30_000 });
  });

  test('oversize attachment keeps the modal open and does not add a builder', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const oversizePath = join(tmpdir(), `baguette-e2e-oversize-${Date.now()}.txt`);
    writeFileSync(oversizePath, 'x'.repeat(6 * 1024 * 1024));
    try {
      await openAddBuilderModalFromAgentTree(page);
      await page.getByPlaceholder('Builder name').fill('Oversize attachment');
      await attachFileInAddBuilderModal(page, oversizePath);
      const beforeCount = (await listSessionAgentsForPage(page)).length;
      await confirmStartSubagentModal(page);
      await expect(page.getByRole('heading', { name: 'Add builder' })).toBeVisible();
      await expect(page.getByText(/5 MB limit/)).toBeVisible();
      await expect
        .poll(async () => (await listSessionAgentsForPage(page)).length)
        .toBe(beforeCount);
    } finally {
      unlinkSync(oversizePath);
    }
  });

  test('agent-tree Add builder works when a pinned secondary is listed first', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    await addManualBuilderAgent(page, 'Pinned secondary');
    await openAddBuilderModalFromAgentTree(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Add builder' })).toHaveCount(0);
  });

  test('Enter inserts a newline in add-builder prompt', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    await openAddBuilderModalFromAgentTree(page);
    const modalComposer = addBuilderModalComposer(page);
    await modalComposer.fill('line one');
    await modalComposer.press('Enter');
    await modalComposer.type('line two');
    await expect(modalComposer).toHaveValue('line one\nline two');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('add-builder composer grows when a large recipe is selected', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await writeE2eRepoBaguetteYaml(repoId, {
      recipes: [
        {
          label: LARGE_RECIPE_LABEL,
          description: 'Many lines to grow the modal textarea',
          prompt: LARGE_RECIPE_PROMPT,
        },
      ],
    });
    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    await openAddBuilderModalFromAgentTree(page);
    const modalComposer = addBuilderModalComposer(page);
    await expect(modalComposer).toHaveValue('');

    const modalForm = page.locator('form', {
      has: page.getByPlaceholder(
        'Optional — leave empty to open the builder with no initial message'
      ),
    });
    const recipesDropdown = modalForm.getByTestId('composer-recipes-dropdown');
    await expect(recipesDropdown).toBeVisible();

    const compactHeight = await modalComposer.evaluate((el) => el.getBoundingClientRect().height);

    await recipesDropdown.getByRole('button', { name: 'Recipes' }).click();
    await page.getByRole('button', { name: LARGE_RECIPE_LABEL }).click();

    await expect(modalComposer).toHaveValue(LARGE_RECIPE_PROMPT);
    await expect
      .poll(async () => modalComposer.evaluate((el) => el.getBoundingClientRect().height))
      .toBeGreaterThan(compactHeight + 80);

    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'start-subagent-modal-large-recipe.png');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Add builder' })).toHaveCount(0);
  });
});
