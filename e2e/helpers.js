import { expect } from '@playwright/test';

export function localRepoName() {
  return `e2e-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Dev sign-in (NODE_ENV=development only). Lands on the dashboard with session cookie set. */
export async function devLogin(page) {
  const authResponse = await page.goto('/auth/dev');
  expect(authResponse?.ok()).toBe(true);
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', {
    timeout: 15_000,
  });
}

export async function listRepos(page) {
  const body = await page.request.get('/api/repos').then((r) => r.json());
  return Array.isArray(body) ? body : (body.data ?? []);
}

/** Create a local repo via Settings → Repositories (no GitHub). Returns repo id. */
export async function createLocalRepo(page, repoName = localRepoName()) {
  await page.goto('/settings?tab=repos');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible();

  const nameInput = page.getByPlaceholder('Repository name (e.g. my-project)');
  await expect(nameInput).toBeVisible({ timeout: 60_000 });

  const localRepoForm = page.locator('form').filter({ has: nameInput });
  await localRepoForm.getByPlaceholder('Repository name (e.g. my-project)').fill(repoName);
  await localRepoForm.getByRole('button', { name: 'Create', exact: true }).click();

  let repoId;
  await expect(async () => {
    const match = (await listRepos(page)).find((r) => r.full_name === repoName);
    repoId = match?.id;
    expect(repoId).toBeTruthy();
  }).toPass({ timeout: 60_000 });

  return repoId;
}

async function waitForMockModelPicker(page) {
  await expect(page.getByLabel('Loading agent and model')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Mock Standard/ })).toBeVisible({
    timeout: 60_000,
  });
}

/** Start a mock builder session from the repo dashboard; returns after session link is visible. */
export async function startMockBuilderSession(
  page,
  repoId,
  prompt = 'Exercise the mock agent for e2e'
) {
  await page.goto(`/repos/${repoId}`);
  const composer = page.getByPlaceholder(/Ask the agent what you want to build or plan/i);
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await waitForMockModelPicker(page);
  await composer.fill(prompt);
  await page.getByRole('button', { name: 'Start on a new branch' }).click();

  const sessionRow = page.getByText(prompt, { exact: true });
  await expect(sessionRow).toBeVisible({ timeout: 120_000 });
  await sessionRow.click();
  await expect(page).toHaveURL(/\/sessions\/[a-f0-9]+|\/repos\/\d+\/sessions\/[a-f0-9]+/, {
    timeout: 30_000,
  });
}
