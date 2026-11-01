import { test, expect } from '@playwright/test';
import { MOCK_STANDARD_MODEL_ID } from '../shared/mock-agent-sdk.js';
import { FIX_MODEL_PRICING_PROMPT } from '../shared/agent-model-pricing.js';
import { devLogin, saveE2eScreenshot, seedE2eUsageDashboard } from './helpers.js';

const WIDE_VIEWPORT = { width: 1280, height: 800 };

test.describe('usage dashboard and model pricing', () => {
  test('seeded usage fills the dashboard and read-only pricing catalog', async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await devLogin(page);
    await seedE2eUsageDashboard(page);

    await page.goto('/usage');
    await expect(page.getByRole('heading', { name: 'Usage', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'model pricing table' })).toBeVisible();
    await expect(page.getByText('User', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Model', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Repo', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Agent type', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('All repos')).toBeVisible();
    await expect(page.getByPlaceholder('All types')).toBeVisible();
    await expect(page.getByRole('button', { name: '7d', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '30d', exact: true })).toBeVisible();

    await page.getByPlaceholder('No users with usage').click();
    await expect(page.getByText('e2e-other')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByText('No token usage in this range.')).toBeHidden();
    await expect(page.getByRole('button', { name: 'By user' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'By model' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'By repo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'By agent' })).toBeVisible();

    await page.getByRole('button', { name: 'By model' }).click();
    await expect(page.getByRole('heading', { name: 'By model' })).toBeVisible();
    await expect(page.getByRole('table').getByText(MOCK_STANDARD_MODEL_ID)).toBeVisible();
    await expect(page.getByRole('table').getByText('claude-sonnet-4-5')).toBeVisible();
    await expect(page.getByText('$0.42').first()).toBeVisible();

    await saveE2eScreenshot(page, 'usage-dashboard.png', { fullPage: true });

    await page.getByRole('link', { name: 'model pricing table' }).click();
    await expect(page).toHaveURL(/\/model-pricing/);
    await expect(page.getByRole('heading', { name: 'Model pricing' })).toBeVisible();
    await expect(page.getByText('This page is read-only.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
    await expect(page.getByRole('table').getByText(MOCK_STANDARD_MODEL_ID)).toBeVisible();
    await expect(page.getByText('Missing', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Global agent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);

    await saveE2eScreenshot(page, 'model-pricing.png', { fullPage: true });

    await page.getByRole('link', { name: 'Global agent' }).click();
    await expect(page).toHaveURL(/\/global\?prompt=/);
    const composer = page.getByPlaceholder(/Ask the agent what you want to build or plan/i);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await expect(composer).toHaveValue(FIX_MODEL_PRICING_PROMPT);
    await saveE2eScreenshot(page, 'global-pricing-prompt.png', { fullPage: true });
  });

  test('legacy usage pricing tab redirects to model pricing', async ({ page }) => {
    await devLogin(page);
    await page.goto('/usage?tab=pricing');
    await expect(page).toHaveURL(/\/model-pricing$/);
    await expect(page.getByRole('heading', { name: 'Model pricing' })).toBeVisible();
  });
});
