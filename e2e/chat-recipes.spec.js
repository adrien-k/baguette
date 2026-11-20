import { test, expect } from './fixtures.js';
import {
  devLogin,
  saveE2eScreenshot,
  saveE2eLocatorScreenshot,
  createLocalRepo,
  startMockBuilderSession,
  expectMockQuickTurnComplete,
  writeE2eRepoBaguetteYaml,
  settleForScreenshot,
} from './helpers.js';
import { MOCK_E2E_QUICK_TURN_PROMPT } from '../shared/mock-agent-sdk.js';

const WIDE_VIEWPORT = { width: 1280, height: 800 };

const E2E_CUSTOM_RECIPE_LABEL = 'E2E custom recipe';
const E2E_CUSTOM_RECIPE_PROMPT = 'e2e custom recipe prompt for chat';

test.describe('session chat recipes', () => {
  test('built-in and custom recipes in composer dropdown', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await writeE2eRepoBaguetteYaml(repoId, {
      recipes: [
        {
          label: E2E_CUSTOM_RECIPE_LABEL,
          description: 'Repo-specific one-click prompt',
          prompt: E2E_CUSTOM_RECIPE_PROMPT,
        },
      ],
    });

    await startMockBuilderSession(page, repoId, MOCK_E2E_QUICK_TURN_PROMPT);
    await expectMockQuickTurnComplete(page);

    const recipesDropdown = page.getByTestId('composer-recipes-dropdown');
    await expect(recipesDropdown).toBeVisible();
    await recipesDropdown.getByRole('button', { name: 'Recipes' }).click();
    await expect(page.getByRole('button', { name: 'Git sync' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check CI' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check comments' })).toBeVisible();
    await expect(page.getByRole('button', { name: E2E_CUSTOM_RECIPE_LABEL })).toBeVisible();
    await expect(page.getByText('Pull latest from the remote and base branch')).toBeVisible();
    await expect(page.getByText('Repo-specific one-click prompt')).toBeVisible();

    await settleForScreenshot(page);
    await saveE2eLocatorScreenshot(recipesDropdown, 'chat-recipes-composer-dropdown.png');

    await page.getByRole('button', { name: E2E_CUSTOM_RECIPE_LABEL }).click();
    const composerInput = page.locator('#chat-input');
    await expect(composerInput).toHaveValue(E2E_CUSTOM_RECIPE_PROMPT);

    await saveE2eScreenshot(page, 'chat-recipes-composer.png', { fullPage: true });
  });
});
