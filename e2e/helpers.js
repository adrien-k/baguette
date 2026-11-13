import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { E2E_THEME, e2eThemeSuffix } from './fixtures.js';
import {
  MOCK_ALT_PRIMARY_MODEL_ID,
  MOCK_CATALOG_ALT_API_KEY,
  MOCK_E2E_CONFIG_A_LABEL,
  MOCK_E2E_CONFIG_B_LABEL,
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_QUICK_TURN_SUMMARY,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PRESET_DESCRIPTION,
  MOCK_E2E_SUBAGENT_PROMPT,
  MOCK_E2E_SUBAGENT_SUMMARY,
  MOCK_E2E_CREATE_PLAN_PROMPT,
  MOCK_E2E_ASK_QUESTION_PROMPT,
  MOCK_REVIEW_ISSUES,
  MOCK_SECONDARY_MODEL_ID,
  MOCK_STANDARD_MODEL_ID,
} from '../shared/mock-agent-sdk.js';
import {
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
} from '../shared/subagent-default-mode.js';

export {
  MOCK_E2E_QUICK_TURN_PROMPT,
  MOCK_E2E_QUICK_TURN_SUMMARY,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PROMPT,
  MOCK_E2E_SUBAGENT_SUMMARY,
  MOCK_E2E_CREATE_PLAN_PROMPT,
  MOCK_E2E_ASK_QUESTION_PROMPT,
};

export function localRepoName() {
  return `e2e-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Dev sign-in (NODE_ENV=development only). Lands on the dashboard with session cookie set.
 *
 * Under E2E_THEME (dark/light runs) the user's stored `color_scheme` is seeded *before*
 * any app page loads, so ColorSchemeProvider adopts the run theme from the user record
 * instead of flipping the theme mid-test (DB default is dark; localStorage alone would
 * be overridden by the user preference once the user object loads). Written directly to
 * the webServer sqlite: the users API patch 401s for pending users, and the theme is not
 * a security boundary in the e2e DB.
 */
export async function devLogin(page, username = 'dev') {
  const path =
    username === 'dev' ? '/auth/dev' : `/auth/dev?username=${encodeURIComponent(username)}`;
  if (E2E_THEME) {
    const seedResponse = await page.request.get(path);
    expect(seedResponse.ok()).toBe(true);
    const me = await page.request.get('/auth/me').then((r) => {
      expect(r.ok()).toBe(true);
      return r.json();
    });
    if (me.user?.id) await setE2eUserColorScheme(me.user.id, E2E_THEME);
  }
  const authResponse = await page.goto(path);
  expect(authResponse?.ok()).toBe(true);
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', {
    timeout: 15_000,
  });
}

export async function devLoginAs(page, username) {
  return devLogin(page, username);
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
  prompt = 'Exercise the mock agent for e2e',
  options = {}
) {
  await page.goto(`/repos/${repoId}`);
  const composer = page.getByPlaceholder(/Ask the agent what you want to build or plan/i);
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await waitForMockModelPicker(page);
  if (options.shared) {
    const sharedSwitch = page.getByRole('switch', { name: 'Shared' });
    await expect(sharedSwitch).toBeVisible({ timeout: 15_000 });
    if ((await sharedSwitch.getAttribute('aria-checked')) !== 'true') {
      await sharedSwitch.click();
    }
  }
  await composer.fill(prompt);
  await page.getByRole('button', { name: 'Start on a new branch' }).click();

  await waitForCreatedSessionOpen(page);
  await expect(page).toHaveURL(/\/sessions\/[a-f0-9]+|\/repos\/\d+\/sessions\/[a-f0-9]+/, {
    timeout: 30_000,
  });
}

/** Wait for the just-created session to open — creation navigates straight into its chat. */
async function waitForCreatedSessionOpen(page) {
  await expect(page).toHaveURL(/\/sessions\//, { timeout: 120_000 });
}

async function waitForSessionProvisioningDone(page) {
  const settingUp = page.getByText('Setting up worktree…');
  if (await settingUp.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await expect(settingUp).toBeHidden({ timeout: 120_000 });
  }
}

export async function expectMockQuickTurnComplete(page) {
  await waitForSessionProvisioningDone(page);
  await openSessionAgentsPanel(page);
  const main = page.locator('li').filter({ hasText: 'Main' });
  await expect(main.getByText(/Completed|Stopped/i)).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByText(MOCK_E2E_QUICK_TURN_SUMMARY)).toBeVisible({ timeout: 60_000 });
}

/** Open the session side panel Agents tab (`?panel=agents`). */
export async function openSessionAgentsPanel(page) {
  const url = new URL(page.url());
  url.searchParams.set('panel', 'agents');
  await page.goto(url.toString());
  await expect(page.getByRole('button', { name: 'Agents', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

export async function ensureSidePanelVisible(page) {
  const agentsTab = page.getByRole('button', { name: 'Agents', exact: true });
  if (await agentsTab.isVisible()) return;
  await page.getByTitle('Show side panel').click();
  await expect(agentsTab).toBeVisible({ timeout: 15_000 });
}

/**
 * Create an extra builder from the composer's Send menu ("Start subagent").
 *
 * The agent is named from the prompt's first four words, so `name` must be at most four
 * words. The prompt sent to it appends the quick mock prompt so its first turn is fast;
 * the helper waits for that turn to complete before returning (the composer targets the
 * new builder meanwhile).
 */
export async function addManualBuilderAgent(page, name) {
  await ensureSidePanelVisible(page);
  await openSessionAgentsPanel(page);
  const composer = await sessionChatComposer(page);
  await composer.fill(`${name} ${MOCK_E2E_QUICK_TURN_PROMPT}`);
  await page.getByTitle('Schedule', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start subagent' }).click();
  const row = page.locator('li').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText(/Completed/i)).toBeVisible({ timeout: 120_000 });
}

export async function selectAgentInPanel(page, name) {
  await openSessionAgentsPanel(page);
  const row = page.locator('li').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('button').first().click();
}

export async function sessionChatComposer(page) {
  return page.getByPlaceholder(/Message .+\.\.\./);
}

export async function sendSessionChatMessage(page, text) {
  const composer = await sessionChatComposer(page);
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await composer.fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

const E2E_SCREENSHOTS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'screenshots');

/**
 * Append the `-<theme>` suffix from E2E_THEME (dark/light) before the file
 * extension so a themed capture run writes a parallel file set instead of
 * overwriting the other theme's screenshots. Idempotent (skips if present).
 */
export function withE2eThemeSuffix(path) {
  const suffix = e2eThemeSuffix();
  if (!suffix) return path;
  const ext = /\.(png|jpeg|jpg)$/.exec(path);
  if (!ext) return path;
  const stem = path.slice(0, -ext[0].length);
  if (stem.endsWith(`-${E2E_THEME}`)) return path;
  return `${stem}${suffix}${ext[0]}`;
}

/** Screenshot file path under `e2e/screenshots/`, themed from E2E_THEME. */
export function saveE2eScreenshotPath(fileName) {
  return withE2eThemeSuffix(join(E2E_SCREENSHOTS_DIR, fileName));
}

export function parseSessionIdFromUrl(url) {
  const match = String(url).match(/\/sessions\/([^/?]+)/);
  return match?.[1] ?? null;
}

export async function listSessionAgentsForPage(page) {
  const sessionId = parseSessionIdFromUrl(page.url());
  expect(sessionId).toBeTruthy();
  const res = await page.request.get('/api/agents', {
    params: { session_id: sessionId, $limit: 100 },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return body.data ?? body;
}

/** Wait until at least one agent is running and at least one is not. */
export async function waitForRunningAndIdleAgents(page, timeout = 60_000) {
  await expect
    .poll(
      async () => {
        const agents = await listSessionAgentsForPage(page);
        const running = agents.filter((a) => a.status === 'running').length;
        const idle = agents.filter((a) => a.status !== 'running').length;
        return running >= 1 && idle >= 1;
      },
      { timeout }
    )
    .toBe(true);
}

export async function openComposerAgentSwitcher(page) {
  const trigger = page.getByRole('button', { name: 'Switch agent' });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Switch agent' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * While a turn is active on one agent and another is idle, open the composer
 * switcher and assert Running / Idle section headings (retries until the menu
 * catches the overlap or times out).
 */
export async function expectComposerAgentSwitcherSections(page, { timeout = 120_000 } = {}) {
  await expect
    .poll(
      async () => {
        const agents = await listSessionAgentsForPage(page);
        const running = agents.filter((a) => a.status === 'running').length;
        const idle = agents.filter((a) => a.status !== 'running').length;
        if (running < 1 || idle < 1) return false;

        const chatTab = page.getByRole('button', { name: 'Chat', exact: true });
        if (await chatTab.isVisible()) {
          await chatTab.click();
        }

        const trigger = page.getByRole('button', { name: 'Switch agent' });
        if (!(await trigger.isVisible())) return false;
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: 'Switch agent' });
        if (!(await dialog.isVisible())) return false;
        const hasRunning = await dialog.getByText('Running', { exact: true }).isVisible();
        const hasIdle = await dialog.getByText('Idle', { exact: true }).isVisible();
        if (!hasRunning || !hasIdle) {
          await page.keyboard.press('Escape');
          return false;
        }
        return true;
      },
      { timeout }
    )
    .toBe(true);
  return page.getByRole('dialog', { name: 'Switch agent' });
}

/**
 * Write a Playwright screenshot under `e2e/screenshots/` (gitignored), or to
 * `E2E_SCREENSHOT_PATH` when that env var is set (single-file override).
 */
export async function saveE2eScreenshot(page, fileName, options = {}) {
  const path = process.env.E2E_SCREENSHOT_PATH
    ? withE2eThemeSuffix(process.env.E2E_SCREENSHOT_PATH)
    : saveE2eScreenshotPath(fileName);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, ...options });
  return path;
}

const E2E_DB_PATH = join(
  fileURLToPath(new URL('..', import.meta.url)),
  '.data-e2e',
  'baguette.sqlite3'
);

/** Set `users.color_scheme` directly in the webServer sqlite (theme runs). */
export async function setE2eUserColorScheme(userId, scheme) {
  const value = scheme === 'light' ? 'light' : 'dark';
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(E2E_DB_PATH, { timeout: 10_000, fileMustExist: true });
  try {
    db.prepare('UPDATE users SET color_scheme = ? WHERE id = ?').run(value, userId);
  } finally {
    db.close();
  }
}

/** Flip the signed-in account's approval `status` (Playwright webServer sqlite). */
export async function setE2eUserApproved(page, approved) {
  const me = await page.request.get('/auth/me').then((r) => r.json());
  const userId = me.user?.id;
  expect(userId).toBeTruthy();

  const value = approved ? 'approved' : 'pending';
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(E2E_DB_PATH, { timeout: 10_000, fileMustExist: true });
  try {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(value, userId);
  } finally {
    db.close();
  }
}

/** Insert a dummy passkey so the onboarding identity step can Continue without WebAuthn. */
export async function seedE2ePasskey(page) {
  const me = await page.request.get('/auth/me').then((r) => r.json());
  const userId = me.user?.id;
  expect(userId).toBeTruthy();

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(E2E_DB_PATH, { timeout: 10_000, fileMustExist: true });
  try {
    db.prepare(
      `INSERT INTO user_passkeys (user_id, credential_id, public_key, counter)
       VALUES (?, ?, ?, 0)`
    ).run(userId, `e2e-cred-${userId}`, 'e2e-public-key');
  } finally {
    db.close();
  }
}

/**
 * Insert usage rows into the Playwright webServer sqlite DB so Usage / Model
 * pricing have tokens, cost, missing prices, and all group-by dimensions.
 * Mock turns do not write usage.
 */
export async function seedE2eUsageDashboard(page) {
  const me = await page.request.get('/auth/me').then((r) => r.json());
  const userId = me.user?.id;
  expect(userId).toBeTruthy();

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(E2E_DB_PATH, { timeout: 10_000, fileMustExist: true });
  try {
    const otherUserId = Number(
      db
        .prepare(
          `INSERT INTO users (github_id, username, status)
           VALUES (?, ?, 'approved')`
        )
        .run(9_000_001, 'e2e-other').lastInsertRowid
    );

    const insert = db.prepare(
      `INSERT INTO usage (
         session_id, user_id, repo_full_name, cost_usd, created_at, agent_sdk,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
         reasoning_tokens, total_tokens, model, agent_type
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = [
      [
        null,
        userId,
        'e2e/usage-dashboard',
        0,
        today,
        'mock',
        8000,
        2000,
        500,
        200,
        0,
        10700,
        MOCK_STANDARD_MODEL_ID,
        'builder',
      ],
      [
        null,
        userId,
        'e2e/usage-dashboard',
        0.42,
        yesterday,
        'claude',
        4000,
        1500,
        0,
        0,
        0,
        5500,
        'claude-sonnet-4-5',
        'builder',
      ],
      [
        null,
        otherUserId,
        '',
        0,
        today,
        'mock',
        1200,
        400,
        0,
        0,
        0,
        1600,
        MOCK_STANDARD_MODEL_ID,
        'subagent',
      ],
    ];
    const tx = db.transaction(() => {
      for (const row of rows) insert.run(...row);
    });
    tx();
  } finally {
    db.close();
  }
}

async function waitForPrimaryBuilderIdle(page) {
  await openSessionAgentsPanel(page);
  const main = page.locator('li').filter({ hasText: 'Main' });
  await expect(main.getByText(/Completed|Stopped/i)).toBeVisible({ timeout: 120_000 });
}

/** Primary builder MCP subagent phrase; waits for a new summary line and subagent row. */
export async function sendSubagentPromptAndWait(page) {
  await waitForPrimaryBuilderIdle(page);
  await selectAgentInPanel(page, 'Main');
  const summaryLocator = page.getByText(MOCK_E2E_SUBAGENT_SUMMARY);
  const summariesBefore = await summaryLocator.count();
  await sendSessionChatMessage(page, MOCK_E2E_SUBAGENT_PROMPT);
  await expect
    .poll(async () => summaryLocator.count(), { timeout: 120_000 })
    .toBeGreaterThan(summariesBefore);
  await openSessionAgentsPanel(page);
  const row = page.locator('li').filter({ hasText: MOCK_E2E_SUBAGENT_NAME }).last();
  await expect(row).toBeVisible({ timeout: 120_000 });
  await expect(row.getByText(/Completed/i)).toBeVisible({ timeout: 120_000 });
}

export async function expectMcpReadonlyComposer(page) {
  await expect(
    page.getByText(
      'This agent only accepts new messages via MCP. Switch to another agent to chat in'
    )
  ).toBeVisible({ timeout: 30_000 });
  await expect(await sessionChatComposer(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Switch agent' })).toBeVisible({
    timeout: 30_000,
  });
}

export async function deleteAgentFromPanel(page, name) {
  await openSessionAgentsPanel(page);
  const row = page.locator('li').filter({ hasText: name });
  await row.getByTitle('Delete agent').click();
  const modal = page.locator('.fixed.inset-0').filter({
    has: page.getByRole('heading', { name: 'Delete agent?' }),
  });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Delete agent', exact: true }).click();
  await expect(row).toHaveCount(0, { timeout: 30_000 });
}

export async function listAgentConfigs(page) {
  const res = await page.request.get('/api/agent-configs');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return body.data ?? body;
}

export async function createMockAgentConfig(page, { label, catalogKey = '', defaultModel }) {
  const res = await page.request.post('/api/agent-configs', {
    data: {
      label,
      sdk: 'mock',
      api_key: catalogKey,
      ...(defaultModel ? { default_model: { model: defaultModel, model_params: null } } : {}),
    },
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`createMockAgentConfig failed: ${res.status()} ${text}`);
  }
  return await res.json();
}

export async function getCurrentUser(page) {
  const res = await page.request.get('/auth/me');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.user?.id).toBeTruthy();
  return body.user;
}

export async function patchUserSessionDefaults(page, fields) {
  const user = await getCurrentUser(page);
  const res = await page.request.patch(`/api/users/${user.id}`, { data: fields });
  expect(res.ok()).toBe(true);
  return await res.json();
}

export async function createPresetModel(page, { description, configId, model }) {
  const res = await page.request.post('/api/agent-model-presets', {
    data: { description, agent_config_id: configId, model },
  });
  expect(res.ok()).toBe(true);
  return await res.json();
}

/**
 * Let hover/focus and color transitions settle before a screenshot: move the mouse
 * off nav/links and give CSS `transition-colors` (~150ms) room to finish, so captures
 * never land mid-fade (a stray half-faded pill can read like a second active tab).
 */
export async function settleForScreenshot(page, ms = 300) {
  await page.mouse.move(4, 4);
  await page.waitForTimeout(ms);
}

/**
 * Wait for `text` to render in the current session chat, reloading the page if the
 * live socket stream missed it (e.g. the ask-question tool row ran before the chat
 * view mounted). Reload is safe: unanswered question cards persist server-side.
 */
export async function expectChatTextWithReload(page, text, timeout = 120_000) {
  await expect
    .poll(
      async () => {
        const locator = page.getByText(text);
        if ((await locator.count()) > 0) return 'found';
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        return (await page.getByText(text).count()) > 0 ? 'found' : 'not-found';
      },
      { timeout, intervals: [5_000, 5_000, 10_000] }
    )
    .toBe('found');
}

export async function ensureMockE2eConfigs(page) {
  const existing = await listAgentConfigs(page);
  let configA = existing.find((c) => c.label === MOCK_E2E_CONFIG_A_LABEL);
  let configB = existing.find((c) => c.label === MOCK_E2E_CONFIG_B_LABEL);
  if (!configA) {
    configA = await createMockAgentConfig(page, {
      label: MOCK_E2E_CONFIG_A_LABEL,
      defaultModel: MOCK_STANDARD_MODEL_ID,
    });
  }
  if (!configB) {
    configB = await createMockAgentConfig(page, {
      label: MOCK_E2E_CONFIG_B_LABEL,
      catalogKey: MOCK_CATALOG_ALT_API_KEY,
      defaultModel: MOCK_ALT_PRIMARY_MODEL_ID,
    });
  }
  return { configA, configB };
}

export async function setupAccountModelDefaults(page, configA) {
  await patchUserSessionDefaults(page, {
    agent_default_config_id: configA.id,
    agent_default_model: { model: MOCK_STANDARD_MODEL_ID, model_params: null },
    reviewer_default_config_id: configA.id,
    reviewer_default_model: { model: MOCK_SECONDARY_MODEL_ID, model_params: null },
    subagent_default_mode: 'inherit',
    subagent_default_config_id: null,
    subagent_default_model: null,
  });
}

function repoComposerRoot(page) {
  return page.locator('form').filter({ has: page.getByPlaceholder(/Ask the agent/) });
}

export function sessionComposerRoot(page) {
  return page.locator('form').filter({ has: page.getByPlaceholder(/Message/) });
}

function composerModelDialog(page) {
  return page.getByRole('dialog', { name: 'Choose agent and model' });
}

/**
 * Open the composer model picker and wait until the dialog stays open.
 * After an agent-config switch the select remounts while models reload, so a
 * single click can land on a node that is about to unmount.
 */
export async function openComposerModelMenu(page, root) {
  const trigger = root
    .getByRole('button', { name: /Mock |Choose agent and model|Choose model/ })
    .first();
  const dialog = composerModelDialog(page);
  await expect(page.getByLabel('Loading agent and model')).toHaveCount(0, { timeout: 60_000 });
  await expect(trigger).toBeEnabled({ timeout: 30_000 });
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

export async function pickComposerAgentConfig(page, root, configLabel) {
  await openComposerModelMenu(page, root);
  const dialog = composerModelDialog(page);
  await dialog.getByRole('button', { name: /^Agent / }).click();
  await page.getByRole('menuitem', { name: configLabel }).click();
  await expect(page.getByLabel('Loading agent and model')).toHaveCount(0, { timeout: 60_000 });
}

export async function pickComposerModelDisplay(page, root, displayName) {
  await openComposerModelMenu(page, root);
  const dialog = composerModelDialog(page);
  await dialog.getByRole('button', { name: displayName, exact: true }).click();
}

export async function expectComposerShowsModel(page, displayName) {
  const pattern = new RegExp(displayName, 'i');
  const root = sessionComposerRoot(page);
  const inWritableComposer = root
    .getByTitle(pattern)
    .or(root.getByRole('button', { name: pattern }));
  // MCP read-only builders render SessionModelSelect outside the message form.
  const modelChip = page.getByRole('button', { name: pattern });
  await expect(inWritableComposer.or(modelChip).first()).toBeVisible({ timeout: 30_000 });
}

export async function startMockSessionOnRepo(
  page,
  repoId,
  { configLabel, modelDisplay, prompt = MOCK_E2E_QUICK_TURN_PROMPT }
) {
  await page.goto(`/repos/${repoId}`);
  const root = repoComposerRoot(page);
  await expect(page.getByPlaceholder(/Ask the agent/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Loading agent and model')).toHaveCount(0, { timeout: 60_000 });
  if (configLabel) {
    await pickComposerAgentConfig(page, root, configLabel);
  }
  if (modelDisplay) {
    await pickComposerModelDisplay(page, root, modelDisplay);
  }
  await page.getByPlaceholder(/Ask the agent/).fill(prompt);
  await page.getByRole('button', { name: 'Start on a new branch' }).click();
  await waitForCreatedSessionOpen(page);
  await expectMockQuickTurnComplete(page);
}

export async function switchSessionComposerConfig(page, configLabel) {
  const root = sessionComposerRoot(page);
  await pickComposerAgentConfig(page, root, configLabel);
}

/** Assert model display names in the open composer model menu (config catalog). */
export async function expectComposerModelMenuLists(page, { show = [], hide = [] } = {}) {
  const root = sessionComposerRoot(page);
  await openComposerModelMenu(page, root);
  const dialog = composerModelDialog(page);
  await expect(dialog).toBeVisible();
  for (const displayName of show) {
    await expect(dialog.getByRole('button', { name: displayName, exact: true })).toBeVisible();
  }
  for (const displayName of hide) {
    await expect(dialog.getByRole('button', { name: displayName, exact: true })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
}

export async function startMockReviewFromIssuesTab(page) {
  await page.getByRole('button', { name: 'Issues' }).click();
  await expect(page.getByRole('button', { name: 'Start review' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: /Mock Secondary/ })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Start review' }).click();
  for (const issue of MOCK_REVIEW_ISSUES) {
    await expect(page.getByText(issue.title)).toBeVisible({ timeout: 120_000 });
  }
  await expect(page.getByText('Review in progress')).toBeHidden({ timeout: 120_000 });
}

/** Issues tab controls shown when a reviewer agent exists and is idle. */
export async function expectIssuesTabReviewerControls(page) {
  await page.getByRole('button', { name: 'Issues' }).click();
  await expect(page.getByRole('button', { name: 'Review latest changes' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
}

/** Close the side-panel drawer on viewports below md (scrim + panel overlay). */
export async function ensureMobileSidePanelClosed(page) {
  const scrim = page.locator('div.md\\:hidden.fixed.inset-0.z-30');
  if ((await scrim.count()) === 0) return;
  if (!(await scrim.first().isVisible())) return;
  await scrim.first().click({ position: { x: 16, y: 400 } });
  await expect(scrim).toHaveCount(0, { timeout: 15_000 });
}

export async function screenshotIssuesTabReviewerControls(
  page,
  screenshotPath,
  { closeMobilePanel = false } = {}
) {
  if (!screenshotPath) return;
  const path = withE2eThemeSuffix(screenshotPath);
  if (closeMobilePanel) {
    await ensureMobileSidePanelClosed(page);
    await page.getByRole('button', { name: 'Issues' }).click();
    await expect(page.getByRole('button', { name: 'Review latest changes' })).toBeVisible({
      timeout: 30_000,
    });
  }
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: false });
}

export async function confirmClearReviewerChatModal(page) {
  const modal = page.locator('.fixed.inset-0').filter({
    has: page.getByRole('heading', { name: 'Clear reviewer chat?' }),
  });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Clear reviewer chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clear reviewer chat?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Issues' }).click();
  await expect(page.getByRole('button', { name: 'Start review' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0);
}

/**
 * Reset the reviewer from the Issues tab (same as Agents panel trash on reviewer).
 * When `E2E_SCREENSHOT_PATH` is set, captures a viewport screenshot before confirming.
 */
export async function resetReviewerFromIssuesTab(page, { screenshotPath } = {}) {
  await expectIssuesTabReviewerControls(page);
  const path = screenshotPath ?? process.env.E2E_SCREENSHOT_PATH;
  if (path) {
    await screenshotIssuesTabReviewerControls(page, path);
  }
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await confirmClearReviewerChatModal(page);
}

export {
  MOCK_ALT_PRIMARY_MODEL_ID,
  MOCK_CATALOG_ALT_API_KEY,
  MOCK_E2E_CONFIG_A_LABEL,
  MOCK_E2E_CONFIG_B_LABEL,
  MOCK_E2E_SUBAGENT_PRESET_DESCRIPTION,
  MOCK_SECONDARY_MODEL_ID,
  MOCK_STANDARD_MODEL_ID,
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
};
