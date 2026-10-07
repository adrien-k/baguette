import { defineConfig, devices } from '@playwright/test';

const appPort = process.env.E2E_PORT || process.env.PORT || '3010';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bash e2e/start-dev.sh',
    url: `http://127.0.0.1:${appPort}/up`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
