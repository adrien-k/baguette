import { test } from './fixtures.js';
import {
  MOCK_E2E_CONFIG_A_LABEL,
  MOCK_E2E_CONFIG_B_LABEL,
  MOCK_E2E_SUBAGENT_NAME,
  MOCK_E2E_SUBAGENT_PRESET_DESCRIPTION,
  MOCK_SECONDARY_MODEL_ID,
  SUBAGENT_DEFAULT_CONFIG,
  SUBAGENT_DEFAULT_PRESET,
  addManualBuilderAgent,
  createLocalRepo,
  createPresetModel,
  deleteAgentViaApi,
  devLogin,
  ensureMockE2eConfigs,
  expectComposerShowsModel,
  expectMcpReadonlyComposer,
  openComposerModelMenu,
  patchUserSessionDefaults,
  saveE2eScreenshot,
  selectAgentInTree,
  selectAgentViaComposer,
  sendSubagentPromptAndWait,
  sessionComposerRoot,
  setupAccountModelDefaults,
  startMockReviewFromIssuesTab,
  startMockSessionOnRepo,
  switchSessionComposerConfig,
  expectComposerModelMenuLists,
} from './helpers.js';

const MANUAL_BUILDER = 'Manual model e2e';

test.describe('model selection (mock)', () => {
  test('session, subagent modes, config switch, and review defaults', async ({ page }) => {
    test.setTimeout(360_000);
    await devLogin(page);
    const { configA } = await ensureMockE2eConfigs(page);
    await setupAccountModelDefaults(page, configA);

    const repoId = await createLocalRepo(page);
    await startMockSessionOnRepo(page, repoId, {
      configLabel: MOCK_E2E_CONFIG_B_LABEL,
      modelDisplay: 'Mock Alt Primary',
    });

    await expectComposerShowsModel(page, 'Mock Alt Primary');

    const manualName = await addManualBuilderAgent(page, MANUAL_BUILDER);
    await selectAgentInTree(page, manualName);
    await expectComposerShowsModel(page, 'Mock Alt Primary');

    await sendSubagentPromptAndWait(page);
    await selectAgentInTree(page, MOCK_E2E_SUBAGENT_NAME);
    await expectMcpReadonlyComposer(page);
    await expectComposerShowsModel(page, 'Mock Alt Primary');

    await deleteAgentViaApi(page, MOCK_E2E_SUBAGENT_NAME);

    await patchUserSessionDefaults(page, {
      subagent_default_mode: SUBAGENT_DEFAULT_CONFIG,
      subagent_default_config_id: configA.id,
      subagent_default_model: { model: MOCK_SECONDARY_MODEL_ID, model_params: null },
    });
    await sendSubagentPromptAndWait(page);
    await selectAgentInTree(page, MOCK_E2E_SUBAGENT_NAME);
    await expectComposerShowsModel(page, 'Mock Secondary');
    await deleteAgentViaApi(page, MOCK_E2E_SUBAGENT_NAME);

    await createPresetModel(page, {
      description: MOCK_E2E_SUBAGENT_PRESET_DESCRIPTION,
      configId: configA.id,
      model: MOCK_SECONDARY_MODEL_ID,
    });
    await patchUserSessionDefaults(page, {
      subagent_default_mode: SUBAGENT_DEFAULT_PRESET,
      subagent_default_config_id: null,
      subagent_default_model: null,
    });
    await sendSubagentPromptAndWait(page);
    await selectAgentInTree(page, MOCK_E2E_SUBAGENT_NAME);
    await expectComposerShowsModel(page, 'Mock Secondary');

    // The primary builder is the session row itself — switch via the composer.
    await selectAgentViaComposer(page, 'Builder');
    await switchSessionComposerConfig(page, MOCK_E2E_CONFIG_A_LABEL);
    await expectComposerShowsModel(page, 'Mock Standard');
    await expectComposerModelMenuLists(page, {
      show: ['Mock Standard', 'Mock Secondary'],
      hide: ['Mock Alt Primary'],
    });
    await openComposerModelMenu(page, sessionComposerRoot(page));
    await saveE2eScreenshot(page, 'composer-model-menu.png');
    await page.keyboard.press('Escape');
    await switchSessionComposerConfig(page, MOCK_E2E_CONFIG_B_LABEL);
    await expectComposerShowsModel(page, 'Mock Alt Primary');
    await expectComposerModelMenuLists(page, {
      show: ['Mock Alt Primary'],
      hide: ['Mock Standard', 'Mock Secondary'],
    });

    await selectAgentInTree(page, manualName);
    await switchSessionComposerConfig(page, MOCK_E2E_CONFIG_A_LABEL);
    await expectComposerShowsModel(page, 'Mock Standard');
    await expectComposerModelMenuLists(page, {
      show: ['Mock Standard', 'Mock Secondary'],
      hide: ['Mock Alt Primary'],
    });

    await startMockReviewFromIssuesTab(page);
    // The primary builder is the session row itself — switch via the composer.
    await selectAgentViaComposer(page, 'Builder');
    await expectComposerShowsModel(page, 'Mock Alt Primary');
    await selectAgentInTree(page, 'Reviewer');
    await expectComposerShowsModel(page, 'Mock Secondary');
  });
});
