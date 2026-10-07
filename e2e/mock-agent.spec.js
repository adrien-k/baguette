import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test, expect } from '@playwright/test';
import { MOCK_AGENT_SUMMARY_TEXT } from '../shared/mock-agent-sdk.js';

const LOCAL_REPO_NAME = `e2e-mock-${Date.now()}`;

async function listRepos(page) {
  const body = await page.request.get('/api/repos').then((r) => r.json());
  return Array.isArray(body) ? body : (body.data ?? []);
}

test.describe('mock agent chat', () => {
  test('dev login, local repo, mock session renders tool calls and summary', async ({ page }) => {
    const authResponse = await page.goto('/auth/dev');
    expect(authResponse?.ok()).toBe(true);
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', {
      timeout: 15_000,
    });

    await page.goto('/settings?tab=repos');
    await expect(page.getByText(/Create a local repository/)).toBeVisible({ timeout: 30_000 });

    const localRepoForm = page.locator('form').filter({
      has: page.getByPlaceholder('Repository name (e.g. my-project)'),
    });
    await localRepoForm.getByPlaceholder('Repository name (e.g. my-project)').fill(LOCAL_REPO_NAME);
    await localRepoForm.getByRole('button', { name: 'Create', exact: true }).click();

    let repoId;
    await expect(async () => {
      const match = (await listRepos(page)).find((r) => r.full_name === LOCAL_REPO_NAME);
      repoId = match?.id;
      expect(repoId).toBeTruthy();
    }).toPass({ timeout: 60_000 });

    await page.goto(`/repos/${repoId}`);

    await expect(page.getByRole('button', { name: 'Mock Standard' })).toBeVisible();

    const composer = page.getByPlaceholder(/Describe what you want the agent to do/i);
    await composer.fill('Exercise the mock agent for e2e');
    await page.getByRole('button', { name: 'Start on a new branch' }).click();

    const sessionLink = page.locator('a[href*="/sessions/"]').first();
    await expect(sessionLink).toBeVisible({ timeout: 120_000 });
    await sessionLink.click();

    await expect(page.getByText('Exercise the mock agent for e2e')).toBeVisible();
    await expect(page.getByText(MOCK_AGENT_SUMMARY_TEXT)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('heading', { name: 'Mock agent plan' })).toBeVisible();
    await expect(page.getByText('ShowDiff').first()).toBeVisible();

    const workGroup = page.getByRole('button', { name: /Worked for .* · \d+ calls/ });
    await workGroup.click();
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
});
