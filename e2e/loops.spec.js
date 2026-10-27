import { test, expect } from '@playwright/test';
import { createLocalRepo, devLogin, ensureMockE2eConfigs } from './helpers.js';

async function listLoops(page) {
  const res = await page.request.get('/api/loops');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return body.data ?? body;
}

test.describe('loops: create new branch toggle (mock)', () => {
  test('is always visible, disabled for global loops, and saved for repo loops', async ({
    page,
  }) => {
    await devLogin(page);
    await ensureMockE2eConfigs(page);
    const repoId = await createLocalRepo(page);

    // Global loop: the toggle is visible but cannot be changed.
    await page.goto('/global/loops');
    const globalToggle = page.getByRole('switch', { name: 'Create new branch' });
    await expect(globalToggle).toBeVisible({ timeout: 60_000 });
    await expect(globalToggle).toBeDisabled();
    await expect(globalToggle).toHaveAttribute('aria-checked', 'false');

    // Repo loop: on by default, sits next to "Single session", and can be turned off.
    await page.goto(`/repos/${repoId}/loops`);
    const toggle = page.getByRole('switch', { name: 'Create new branch' });
    await expect(toggle).toBeVisible({ timeout: 60_000 });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    const singleSession = page.getByRole('switch', { name: 'Single session' });
    const [toggleBox, singleBox] = await Promise.all([
      toggle.boundingBox(),
      singleSession.boundingBox(),
    ]);
    expect(Math.abs(toggleBox.y - singleBox.y)).toBeLessThan(8);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    const prompt = `e2e loop same branch ${Date.now()}`;
    await page.getByPlaceholder('Describe what the agent should do on every run...').fill(prompt);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    let loop;
    await expect(async () => {
      loop = (await listLoops(page)).find((l) => l.prompt === prompt);
      expect(loop).toBeTruthy();
    }).toPass({ timeout: 30_000 });
    expect(loop.create_new_branch).toBe(false);

    // Re-open it for editing: the saved value is shown, and saving keeps it.
    await page.getByTitle('Edit loop').first().click();
    const editToggle = page.getByRole('switch', { name: 'Create new branch' });
    await expect(editToggle).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(async () => {
      const saved = (await listLoops(page)).find((l) => l.id === loop.id);
      expect(saved.create_new_branch).toBe(false);
    }).toPass({ timeout: 30_000 });
  });
});
