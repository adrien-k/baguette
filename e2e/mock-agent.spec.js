import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  MOCK_AGENT_SUMMARY_TEXT,
  MOCK_E2E_CREATE_PLAN_PROMPT,
  MOCK_REVIEW_ISSUES,
} from '../shared/mock-agent-sdk.js';
import { createLocalRepo, devLogin, startMockBuilderSession } from './helpers.js';

test.describe('mock agent chat', () => {
  test('dev login, local repo, mock session renders tool calls and summary', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId);

    await expect(page.getByText('Exercise the mock agent for e2e')).toBeVisible();
    const workGroup = page.getByRole('button', { name: /Worked for .* · \d+ calls/ });
    await expect(workGroup).toBeVisible({ timeout: 120_000 });
    await workGroup.click();
    await expect(page.getByText('ShowDiff').first()).toBeVisible();
    await expect(page.getByText(MOCK_AGENT_SUMMARY_TEXT)).toBeVisible();
    await expect(page.getByText(MOCK_E2E_CREATE_PLAN_PROMPT)).toBeVisible();
    await expect(page.getByText('Exercise every tool kind').first()).toBeVisible();
    await expect(
      page
        .locator('code')
        .filter({ hasText: /sleep|mock bash/ })
        .first()
    ).toBeVisible();
    await expect(page.getByText('.baguette-mock/notes.txt').first()).toBeVisible();

    const screenshotPath = process.env.E2E_SCREENSHOT_PATH;
    if (screenshotPath) {
      await mkdir(dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
  });

  test('mock builder session then mock reviewer creates issues on Issues tab', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId);

    await expect(page.getByText(MOCK_AGENT_SUMMARY_TEXT)).toBeVisible({ timeout: 120_000 });

    await page.getByRole('button', { name: 'Issues' }).click();
    await expect(page.getByRole('button', { name: 'Start review' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Start review' }).click();

    for (const issue of MOCK_REVIEW_ISSUES) {
      await expect(page.getByText(issue.title)).toBeVisible({ timeout: 120_000 });
    }
    await expect(page.getByText('Review in progress')).toBeHidden({ timeout: 120_000 });
  });
});
