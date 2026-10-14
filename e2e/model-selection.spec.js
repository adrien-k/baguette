import { test } from '@playwright/test';
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
  deleteAgentFromPanel,
  devLogin,
  ensureMockE2eConfigs,
  expectComposerShowsModel,
  expectMcpReadonlyComposer,
  patchUserSessionDefaults,
  selectAgentInPanel,
  sendSubagentPromptAndWait,
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

    await addManualBuilderAgent(page, MANUAL_BUILDER);
    await selectAgentInPanel(page, MANUAL_BUILDER);
    await expectComposerShowsModel(page, 'Mock Alt Primary');

    await sendSubagentPromptAndWait(page);
    await selectAgentInPanel(page, MOCK_E2E_SUBAGENT_NAME);
    await expectMcpReadonlyComposer(page);
    await expectComposerShowsModel(page, 'Mock Alt Primary');

    await deleteAgentFromPanel(page, MOCK_E2E_SUBAGENT_NAME);

    await patchUserSessionDefaults(page, {
      subagent_default_mode: SUBAGENT_DEFAULT_CONFIG,
      subagent_default_config_id: configA.id,
      subagent_default_model: { model: MOCK_SECONDARY_MODEL_ID, model_params: null },
    });
    await sendSubagentPromptAndWait(page);
    await selectAgentInPanel(page, MOCK_E2E_SUBAGENT_NAME);
    await expectComposerShowsModel(page, 'Mock Secondary');
    await deleteAgentFromPanel(page, MOCK_E2E_SUBAGENT_NAME);

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
    await selectAgentInPanel(page, MOCK_E2E_SUBAGENT_NAME);
    await expectComposerShowsModel(page, 'Mock Secondary');

    await selectAgentInPanel(page, 'Main');
    await switchSessionComposerConfig(page, MOCK_E2E_CONFIG_A_LABEL);
    await expectComposerShowsModel(page, 'Mock Standard');
    await expectComposerModelMenuLists(page, {
      show: ['Mock Standard', 'Mock Secondary'],
      hide: ['Mock Alt Primary'],
    });
    await switchSessionComposerConfig(page, MOCK_E2E_CONFIG_B_LABEL);
    await expectComposerShowsModel(page, 'Mock Alt Primary');
    await expectComposerModelMenuLists(page, {
      show: ['Mock Alt Primary'],
      hide: ['Mock Standard', 'Mock Secondary'],
    });

    await selectAgentInPanel(page, MANUAL_BUILDER);
    await switchSessionComposerConfig(page, MOCK_E2E_CONFIG_A_LABEL);
    await expectComposerShowsModel(page, 'Mock Standard');
    await expectComposerModelMenuLists(page, {
      show: ['Mock Standard', 'Mock Secondary'],
      hide: ['Mock Alt Primary'],
    });

    await startMockReviewFromIssuesTab(page);
    await selectAgentInPanel(page, 'Main');
    await expectComposerShowsModel(page, 'Mock Alt Primary');
    await selectAgentInPanel(page, 'Reviewer');
    await expectComposerShowsModel(page, 'Mock Secondary');
  });
});
