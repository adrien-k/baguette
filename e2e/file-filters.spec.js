import { test, expect } from './fixtures.js';
import { MOCK_AGENT_SUMMARY_TEXT } from '../shared/mock-agent-sdk.js';
import {
  commitWorktreeFiles,
  createLocalRepo,
  devLogin,
  getE2eSessionWorktreePath,
  parseSessionIdFromUrl,
  saveE2eScreenshot,
  startMockBuilderSession,
} from './helpers.js';

const PANEL_VP = { width: 1440, height: 900 };

/**
 * Fixture files committed into the mock session worktree (plus the mock turn's
 * `.baguette-mock/notes.txt`) give the Files panel and Diff view five distinct
 * paths to filter on.
 */
const SAMPLE_FILES = {
  'src/app.jsx': 'export default function App() {\n  return <h1>Hello</h1>;\n}\n',
  // Not named *.test.* so vitest never picks the committed fixture up as a test.
  'src/app-tests.jsx':
    "import { expect, it } from 'vitest';\n\nit('renders', () => {\n  expect(true).toBe(true);\n});\n",
  'docs/overview.md': '# Overview\n\nThis file survives the include filter.\n',
  'package-lock.json': '{\n  "name": "fixture",\n  "lockfileVersion": 3,\n  "packages": {}\n}\n',
};

const ALL_BASENAMES = ['notes.txt', 'app.jsx', 'app-tests.jsx', 'overview.md', 'package-lock.json'];

/** Side panel container: the panel div wraps the resize-handle separator. */
function sidePanel(page) {
  return page.locator('[aria-label="Resize side panel"]').locator('..');
}

test.describe('file panel regex filters', () => {
  test('include/exclude regex narrow the files panel and diff view in sync', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(PANEL_VP);
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId);
    await expect(page.getByText(MOCK_AGENT_SUMMARY_TEXT)).toBeVisible({ timeout: 120_000 });

    const sessionId = parseSessionIdFromUrl(page.url());
    const worktree = await getE2eSessionWorktreePath(sessionId);
    expect(worktree).toBeTruthy();
    await commitWorktreeFiles(worktree, SAMPLE_FILES);

    // Open the Files tab: all five committed files are listed unfiltered.
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const panel = sidePanel(page);
    for (const basename of ALL_BASENAMES) {
      await expect(panel.getByText(basename, { exact: true })).toBeVisible();
    }

    // Expand the filter section — collapsed by default, no clear button yet.
    await page.getByRole('button', { name: 'Filters' }).click();
    const includeInput = page.locator('#files-include-filter');
    const excludeInput = page.locator('#files-exclude-filter');
    await expect(includeInput).toBeVisible();
    await expect(excludeInput).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);

    // Include regex narrows the panel list and shows the match count.
    await includeInput.fill('\\.md$');
    await expect(panel.getByText('Showing 1 of 5 files')).toBeVisible();
    await expect(panel.getByText('overview.md', { exact: true })).toBeVisible();
    await expect(panel.getByText('app.jsx', { exact: true })).toBeHidden();
    await expect(panel.getByRole('button', { name: 'Clear filters' })).toBeVisible();

    await saveE2eScreenshot(page, 'file-filters-panel.png');

    // The diff view follows the same filters: one file section, updated count.
    // The view tab renders before the chat quick-action "Diff" button, so .first().
    await page.getByRole('button', { name: 'Diff', exact: true }).first().click();
    await expect(page.getByText('Showing 1 of 5 changed files')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('docs/overview.md')).toBeVisible();
    await expect(page.getByText('src/app.jsx')).toBeHidden();

    await saveE2eScreenshot(page, 'file-filters-diff.png');

    // No-match include hides everything in both views at once.
    await includeInput.fill('no-such-path');
    await expect(page.getByText('No files match the current filters.')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(2);

    await saveE2eScreenshot(page, 'file-filters-no-match.png');

    // Clearing from the panel recovers both views (shared filter state).
    await panel.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByText('5 files changed')).toBeVisible();
    for (const basename of ALL_BASENAMES) {
      await expect(panel.getByText(basename, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('No files match the current filters.')).toHaveCount(0);

    // Exclude regex alone keeps notes.txt and overview.md (2 of 5).
    await excludeInput.fill('\\.jsx$|package-lock');
    await expect(panel.getByText('Showing 2 of 5 files')).toBeVisible();
    await expect(panel.getByText('notes.txt', { exact: true })).toBeVisible();
    await expect(panel.getByText('overview.md', { exact: true })).toBeVisible();
    await expect(panel.getByText('app.jsx', { exact: true })).toBeHidden();
    await expect(page.getByText('Showing 2 of 5 changed files')).toBeVisible();
    await expect(page.getByText('.baguette-mock/notes.txt')).toBeVisible();
    await expect(page.getByText('src/app.jsx')).toBeHidden();

    // An invalid regex shows an inline error and stops filtering (other field still active).
    await includeInput.fill('a(');
    await expect(page.getByText(/Invalid regular expression/)).toBeVisible();
    await expect(page.getByText('Showing 2 of 5 files')).toBeVisible();
    await includeInput.fill('');
    await expect(page.getByText(/Invalid regular expression/)).toBeHidden();
  });

  test('filter patterns survive a full page reload', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(PANEL_VP);
    await devLogin(page);

    const repoId = await createLocalRepo(page);
    await startMockBuilderSession(page, repoId);
    await expect(page.getByText(MOCK_AGENT_SUMMARY_TEXT)).toBeVisible({ timeout: 120_000 });

    const sessionId = parseSessionIdFromUrl(page.url());
    const worktree = await getE2eSessionWorktreePath(sessionId);
    expect(worktree).toBeTruthy();
    await commitWorktreeFiles(worktree, SAMPLE_FILES);

    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.locator('#files-include-filter').fill('\\.md$');

    const panel = sidePanel(page);
    await expect(panel.getByText('Showing 1 of 5 files')).toBeVisible();

    await page.reload();
    await expect(page.getByText(MOCK_AGENT_SUMMARY_TEXT)).toBeVisible({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Files', exact: true }).click();

    await expect(page.locator('#files-include-filter')).toHaveValue('\\.md$');
    await expect(panel.getByText('Showing 1 of 5 files')).toBeVisible();
    await expect(panel.getByText('overview.md', { exact: true })).toBeVisible();
  });
});
