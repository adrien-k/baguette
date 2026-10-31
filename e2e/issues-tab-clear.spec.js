import { test, expect } from '@playwright/test';
import { MOCK_REVIEW_ISSUES } from '../shared/mock-agent-sdk.js';
import {
  confirmClearReviewerChatModal,
  createLocalRepo,
  devLogin,
  expectIssuesTabReviewerControls,
  openSessionAgentsPanel,
  screenshotIssuesTabReviewerControls,
  startMockBuilderSession,
} from './helpers.js';

const NARROW_VIEWPORT = { width: 390, height: 844 };
const WIDE_VIEWPORT = { width: 1280, height: 800 };

test.describe('Issues tab reset reviewer', () => {
  test('Reset removes reviewer agent but keeps issues', async ({ page }) => {
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId);

    await page.getByRole('button', { name: 'Issues' }).click();
    await expect(page.getByRole('button', { name: 'Start review' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Start review' }).click();
    for (const issue of MOCK_REVIEW_ISSUES) {
      await expect(page.getByText(issue.title)).toBeVisible({ timeout: 120_000 });
    }
    await expect(page.getByText('Review in progress')).toBeHidden({ timeout: 120_000 });

    await expectIssuesTabReviewerControls(page);

    await page.setViewportSize(NARROW_VIEWPORT);
    await screenshotIssuesTabReviewerControls(page, process.env.E2E_SCREENSHOT_PATH_NARROW, {
      closeMobilePanel: true,
    });

    await page.setViewportSize(WIDE_VIEWPORT);
    await screenshotIssuesTabReviewerControls(page, process.env.E2E_SCREENSHOT_PATH_WIDE);

    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await confirmClearReviewerChatModal(page);

    for (const issue of MOCK_REVIEW_ISSUES) {
      await expect(page.getByText(issue.title)).toBeVisible();
    }

    await openSessionAgentsPanel(page);
    await expect(page.locator('li').filter({ hasText: 'Reviewer' })).toHaveCount(0);
  });
});
