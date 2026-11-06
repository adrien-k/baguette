import { test, expect } from '@playwright/test';
import {
  createLocalRepo,
  devLogin,
  devLoginAs,
  saveE2eScreenshot,
  sendSessionChatMessage,
  startMockBuilderSession,
} from './helpers.js';

test.describe('shared loops and sessions', () => {
  test('another user can open a shared session, chat, and cannot archive', async ({
    browser,
    page,
  }) => {
    await devLogin(page);
    const repoId = await createLocalRepo(page);
    const prompt = `Shared e2e chat ${Date.now()}`;
    await startMockBuilderSession(page, repoId, prompt, { shared: true });
    await expect(page.getByText(prompt)).toBeVisible({ timeout: 60_000 });

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await devLoginAs(pageB, 'e2e-other');
    await pageB.goto('/');
    await expect(pageB.getByTitle('All sessions')).toBeVisible({ timeout: 30_000 });
    await pageB.getByTitle('All sessions').click();
    await expect(pageB.getByRole('button', { name: 'Shared with me' })).toBeVisible({
      timeout: 30_000,
    });
    await pageB.getByRole('button', { name: 'Shared with me' }).click();
    await expect(pageB).toHaveURL(/\/shared/, { timeout: 30_000 });

    const sessionLink = pageB.getByRole('link').filter({ hasText: prompt });
    await expect(sessionLink).toBeVisible({ timeout: 30_000 });
    const ownerAvatar = sessionLink.locator('xpath=..').getByLabel('dev');
    await expect(ownerAvatar).toBeVisible();
    await ownerAvatar.hover();
    await expect(pageB.getByText('dev', { exact: true })).toBeVisible();
    await saveE2eScreenshot(pageB, 'shared-with-me-owner-avatar.png');
    await sessionLink.click();
    await expect(pageB).toHaveURL(/\/shared\/sessions\//, { timeout: 30_000 });

    await sendSessionChatMessage(pageB, 'Hello from the other user');
    await expect(pageB.getByText('Hello from the other user')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.locator('span.shrink-0', { hasText: /^You$/ }).first()).toBeVisible();
    await expect(pageB.locator('span.truncate', { hasText: /^dev$/ }).first()).toBeVisible();

    await expect(pageB.getByTitle('Archive session')).toHaveCount(0);

    await saveE2eScreenshot(pageB, 'shared-session-chat.png', { fullPage: true });
    await contextB.close();
  });
});
