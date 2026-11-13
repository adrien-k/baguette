import { test, expect } from './fixtures.js';
import {
  devLogin,
  saveE2eScreenshot,
  seedE2ePasskey,
  setE2eUserApproved,
  settleForScreenshot,
} from './helpers.js';

const WIDE_VIEWPORT = { width: 1280, height: 800 };

test.describe('bootstrap onboarding without GitHub', () => {
  test.describe.configure({ mode: 'serial' });

  test('empty instance shows the bootstrap setup form', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Set up this Baguette' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toHaveCount(0);
    await saveE2eScreenshot(page, 'bootstrap-setup.png');
  });

  test('admin area, personal settings, and skippable GitHub App wizard', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await devLogin(page);

    // Avatar trigger: image when the user has one, letter fallback "dev" button otherwise.
    const avatarTrigger = page
      .locator('nav img.rounded-full')
      .or(page.getByRole('button', { name: 'dev', exact: true }))
      .first();
    await expect(avatarTrigger).toBeVisible({ timeout: 30_000 });
    await avatarTrigger.click();
    const settingsLink = page.getByRole('link', { name: 'Settings' });
    const adminLink = page.getByRole('link', { name: 'Admin' });
    await expect(settingsLink).toBeVisible();
    await expect(adminLink).toBeVisible();
    const settingsBox = await settingsLink.boundingBox();
    const adminBox = await adminLink.boundingBox();
    expect(adminBox?.y).toBeGreaterThan(settingsBox?.y ?? 0);
    await saveE2eScreenshot(page, 'user-menu-admin.png');

    await page.goto('/admin?tab=users');
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Users', exact: true })).toBeVisible();
    await expect(page.getByText('Invite additional users with a one-time link')).toBeVisible();
    await page.getByPlaceholder('username').fill('invited-user');
    await page.getByRole('button', { name: 'Create invite' }).click();
    await expect(page.getByText('Copy this invite link now')).toBeVisible();
    await expect(page.getByText('Invited', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText('dev', { exact: true })).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^Admin$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove admin' })).toBeDisabled();
    await saveE2eScreenshot(page, 'admin-users.png', { fullPage: true });

    await page.getByRole('button', { name: 'GitHub App' }).click();
    await expect(page.getByRole('heading', { name: 'GitHub App' })).toBeVisible();
    await expect(page.getByText('Not configured')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create GitHub App' })).toBeVisible();
    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'admin-github-app.png', { fullPage: true });

    await page.getByRole('button', { name: 'Secrets' }).click();
    await expect(page.getByRole('heading', { name: 'System-wide secrets' })).toBeVisible();
    await settleForScreenshot(page);
    await saveE2eScreenshot(page, 'admin-secrets.png', { fullPage: true });

    await page.goto('/settings?tab=account');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Users', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
    await saveE2eScreenshot(page, 'settings-account.png', { fullPage: true });

    await page.goto('/settings?tab=repos');
    await expect(page.getByRole('heading', { name: 'Repositories', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'GitHub token' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'SSH key' })).toHaveCount(0);
    await saveE2eScreenshot(page, 'settings-repos.png', { fullPage: true });

    const me = await page.request.get('/auth/me').then((r) => r.json());
    const userId = me.user?.id;
    expect(userId).toBeTruthy();
    const patch = await page.request.patch(`/api/users/${userId}`, {
      data: { onboarding_completed: false },
    });
    expect(patch.ok()).toBe(true);

    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Create a GitHub App' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create GitHub App' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select repo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^dev$/ })).toHaveCount(0);
    await saveE2eScreenshot(page, 'onboarding-github-app.png');

    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your identity' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Passkey', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('ghp_… or github_pat_…')).toHaveCount(0);
    await expect(page.getByText('SSH key', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select repo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^dev$/ })).toHaveCount(0);
    await saveE2eScreenshot(page, 'onboarding-identity.png');

    await seedE2ePasskey(page);
    await page.goto('/onboarding?step=identity');
    await expect(page.getByRole('heading', { name: 'Set up your identity' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('1 passkey registered.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Git credentials' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('GitHub personal access token')).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toHaveCount(0);
    await expect(page.getByText('SSH key', { exact: true })).toHaveCount(0);
    await saveE2eScreenshot(page, 'onboarding-git-credentials.png');

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Add GitHub repositories' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('SSH remote', { exact: true })).toHaveCount(0);
    await saveE2eScreenshot(page, 'onboarding-repositories.png');

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Connect your agents' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Finish setup' })).toBeVisible();
    await saveE2eScreenshot(page, 'onboarding-agents.png');
  });

  test('logged-out login after a passkey exists offers passkey sign-in, not create-account', async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await devLogin(page);
    await page.getByRole('button', { name: /dev/ }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Baguette' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
    await expect(page.getByText('Ask an admin for an invite link')).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toHaveCount(0);
    await saveE2eScreenshot(page, 'login-passkey.png');

    await page.goto('/invite/bginv_missing');
    await expect(page.getByRole('heading', { name: 'Join Baguette' })).toBeVisible();
    await expect(page.getByText('invalid or has already been used')).toBeVisible();
    await saveE2eScreenshot(page, 'invite-invalid.png');
  });

  test('pending account screen shows the logo and a log out button', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await devLogin(page);
    await setE2eUserApproved(page, false);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Account Pending' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page.locator('svg[viewBox="0 0 64 64"]')).toBeVisible();
    await saveE2eScreenshot(page, 'account-pending.png');
    // Restore approval before logging out (cookie still authorizes reading the user) —
    // serial tests after this one must not sign in to a pending account.
    await setE2eUserApproved(page, true);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Baguette' })).toBeVisible({ timeout: 30_000 });
  });
});
