import { test, expect } from '@playwright/test';
import {
  MOCK_E2E_ASK_ANSWER_SUMMARY,
  MOCK_E2E_ASK_QUESTION_PROMPT,
  MOCK_E2E_ASK_QUESTION_TEXT,
  MOCK_E2E_CREATE_PLAN_NON_INTERACTIVE_PROMPT,
  MOCK_E2E_CREATE_PLAN_PROMPT,
  MOCK_E2E_PLAN_NON_INTERACTIVE_SUMMARY,
  MOCK_E2E_PLAN_RUN_SUMMARY,
} from '../shared/mock-agent-sdk.js';
import { createLocalRepo, devLogin, startMockBuilderSession } from './helpers.js';

test.describe('mock agent plan and questions', () => {
  test('CreatePlan UI then Run the plan sends follow-up turn', async ({ page }) => {
    await devLogin(page);
    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_CREATE_PLAN_PROMPT);

    await expect(page.getByText('Plan created')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('heading', { name: 'E2E mock plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Run the plan' }).click();

    await expect(page.getByText(MOCK_E2E_PLAN_RUN_SUMMARY)).toBeVisible({ timeout: 120_000 });
  });

  test('CreatePlan with interactive false continues turn without Run the plan', async ({
    page,
  }) => {
    await devLogin(page);
    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_CREATE_PLAN_NON_INTERACTIVE_PROMPT);

    await expect(page.getByText(MOCK_E2E_PLAN_NON_INTERACTIVE_SUMMARY)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText('Plan created')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E mock orchestration plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run the plan' })).toHaveCount(0);
  });

  test('AskUserQuestions UI then answer sends follow-up turn', async ({ page }) => {
    await devLogin(page);
    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId, MOCK_E2E_ASK_QUESTION_PROMPT);

    await expect(page.getByText('The agent has a question')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(MOCK_E2E_ASK_QUESTION_TEXT)).toBeVisible();
    await page.getByRole('button', { name: 'Plan flow' }).click();

    await expect(page.getByText(MOCK_E2E_ASK_ANSWER_SUMMARY)).toBeVisible({ timeout: 120_000 });
  });
});
