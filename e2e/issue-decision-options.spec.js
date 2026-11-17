import { test, expect } from './fixtures.js';
import { MOCK_AGENT_SUMMARY_TEXT, MOCK_REVIEW_ISSUES } from '../shared/mock-agent-sdk.js';
import {
  createLocalRepo,
  devLogin,
  parseSessionIdFromUrl,
  saveE2eScreenshot,
  startMockBuilderSession,
} from './helpers.js';

const WIDE_VIEWPORT = { width: 1280, height: 800 };

const DECISION_OPTIONS = [
  { id: 'keep', title: 'Keep the current API', description: 'No migration' },
  { id: 'rewrite', title: 'Rewrite the schema', description: 'Breaking change' },
];

test.describe('Issue decision options', () => {
  test('needs_decision picker, badge count, and option selection', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
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

    const sessionId = parseSessionIdFromUrl(page.url());
    expect(sessionId).toBeTruthy();

    const listRes = await page.request.get('/api/session-issues', {
      params: { session_id: sessionId, $limit: 100 },
    });
    expect(listRes.ok()).toBe(true);
    const listBody = await listRes.json();
    const issues = Array.isArray(listBody) ? listBody : (listBody.data ?? []);
    const openedIssue = issues.find((i) => i.status === 'opened');
    expect(openedIssue).toBeTruthy();

    const patchRes = await page.request.patch(`/api/session-issues/${openedIssue.id}`, {
      data: { options: DECISION_OPTIONS },
    });
    expect(patchRes.ok()).toBe(true);

    const decisionHeading = page.getByRole('heading', { name: /Needs your decision/ });
    const headingVisible = await decisionHeading.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!headingVisible) {
      await page.getByRole('button', { name: 'Issues' }).click();
    }
    await expect(decisionHeading).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText('Keep the current API')).toBeVisible();
    await expect(page.getByText('Rewrite the schema')).toBeVisible();
    await expect(page.getByText(openedIssue.title)).toBeVisible();

    await expect(page.getByRole('button', { name: 'Fix all opened (1)' })).toBeVisible();

    const issuesTab = page.getByRole('button', { name: 'Issues' });
    const tabBadge = issuesTab.locator('span.rounded-full');
    await expect(tabBadge).toBeVisible();
    const badgeCount = Number.parseInt(await tabBadge.textContent(), 10);
    expect(badgeCount).toBeGreaterThanOrEqual(2);

    const otherMockTitle = MOCK_REVIEW_ISSUES.find((m) => m.title !== openedIssue.title)?.title;
    if (otherMockTitle) {
      await expect(page.getByText(otherMockTitle)).toBeVisible();
    }

    await saveE2eScreenshot(page, 'needs-decision-picker.png', { fullPage: true });

    await page.getByRole('button', { name: 'Keep the current API' }).click();

    await expect(decisionHeading).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Decision: Keep the current API')).toBeVisible();
    await expect(page.locator('text=needs decision')).toHaveCount(0);

    const decisionCard = page.locator(`#issue-${openedIssue.ref}`);
    await expect(decisionCard.getByRole('button', { name: 'Ask agent to fix' })).toBeVisible();

    await saveE2eScreenshot(page, 'decision-selected.png', { fullPage: true });
  });
});
