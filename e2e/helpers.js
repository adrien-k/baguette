import { expect } from '@playwright/test';
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

  await openRepoSessionFromList(page, prompt);
  await expect(page).toHaveURL(/\/sessions\/[a-f0-9]+|\/repos\/\d+\/sessions\/[a-f0-9]+/, {
    timeout: 30_000,
  });
}

/** Click a session card on the repo dashboard (not the new-session composer textarea). */
async function openRepoSessionFromList(page, prompt) {
  const sessionRow = page.getByRole('paragraph').filter({ hasText: prompt });
  await expect(sessionRow).toBeVisible({ timeout: 120_000 });
  await sessionRow.click();
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

export async function addManualBuilderAgent(page, name) {
  await ensureSidePanelVisible(page);
  await openSessionAgentsPanel(page);
  await page.getByRole('button', { name: 'Add builder' }).click();
  const nameInput = page.getByPlaceholder('e.g. Research');
  await nameInput.fill(name);
  await nameInput.press('Enter');
  await expect(page.locator('li').filter({ hasText: name })).toBeVisible({ timeout: 30_000 });
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

function sessionComposerRoot(page) {
  return page.locator('form').filter({ has: page.getByPlaceholder(/Message/) });
}

export async function openComposerModelMenu(page, root) {
  const trigger = root
    .getByRole('button', { name: /Mock |Choose agent and model|Choose model/ })
    .first();
  await trigger.click();
}

function composerModelDialog(page) {
  return page.getByRole('dialog', { name: 'Choose agent and model' });
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
  await openRepoSessionFromList(page, prompt);
  await expect(page).toHaveURL(/\/sessions\//, { timeout: 30_000 });
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
