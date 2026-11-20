import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { usersService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';
import DefaultAgentPicker, {
  AgentDefaultModelPicker,
} from '../../components/settings/DefaultAgentPicker.jsx';
import SubagentDefaultPicker from '../../components/settings/SubagentDefaultPicker.jsx';
import {
  SUBAGENT_DEFAULT_INHERIT,
  normalizeSubagentDefaultMode,
} from '@baguette/shared/subagent-default-mode.js';
import { SettingsSaveRow, SettingsSection } from '../../components/SettingsSection.jsx';
import DefaultUsageLimitsFields from '../../components/settings/DefaultUsageLimitsFields.jsx';
import {
  DEFAULT_USAGE_LIMIT_ACTION,
  parseUsageLimit,
  usageLimitInputText,
} from '../../utils/usageLimitActions.jsx';

function SectionActions({ saving, saved, disabled, onSave, onClear }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-line/60">
      <SettingsSaveRow saving={saving} saved={saved} disabled={disabled} onSave={onSave} />
      <button
        type="button"
        onClick={onClear}
        disabled={disabled || saving}
        className="text-xs text-faint hover:text-secondary disabled:opacity-50"
      >
        Clear
      </button>
    </div>
  );
}

export default function AgentDefaultsSection({ settings, onSave }) {
  const { user } = useAuth();
  const { loading: configsLoading } = useAgentConfigs();

  const [agentConfigId, setAgentConfigId] = useState(null);
  const [agentModel, setAgentModel] = useState(null);
  const [agentModelParamsJson, setAgentModelParamsJson] = useState(null);

  const [reviewerConfigId, setReviewerConfigId] = useState(null);
  const [reviewerModel, setReviewerModel] = useState(null);
  const [reviewerModelParamsJson, setReviewerModelParamsJson] = useState(null);

  const [subagentMode, setSubagentMode] = useState(SUBAGENT_DEFAULT_INHERIT);
  const [subagentConfigId, setSubagentConfigId] = useState(null);
  const [subagentModel, setSubagentModel] = useState(null);
  const [subagentModelParamsJson, setSubagentModelParamsJson] = useState(null);

  const [utilityConfigId, setUtilityConfigId] = useState(null);
  const [utilityModel, setUtilityModel] = useState(null);
  const [utilityModelParamsJson, setUtilityModelParamsJson] = useState(null);

  const [defaultUsageLimitAction, setDefaultUsageLimitAction] = useState(
    DEFAULT_USAGE_LIMIT_ACTION
  );
  const [defaultUsageLimitText, setDefaultUsageLimitText] = useState('');

  const [savingSection, setSavingSection] = useState(null);
  const [savedSection, setSavedSection] = useState(null);

  const hydrateFromSettings = useCallback(() => {
    if (!settings) return;
    setAgentConfigId(settings.agent_default_config_id ?? null);
    setAgentModel(settings.agent_default_model?.model ?? null);
    setAgentModelParamsJson(
      settings.agent_default_model?.model_params?.length
        ? JSON.stringify(settings.agent_default_model.model_params)
        : null
    );
    setReviewerConfigId(settings.reviewer_default_config_id ?? null);
    setReviewerModel(settings.reviewer_default_model?.model ?? null);
    setReviewerModelParamsJson(
      settings.reviewer_default_model?.model_params?.length
        ? JSON.stringify(settings.reviewer_default_model.model_params)
        : null
    );
    setSubagentMode(normalizeSubagentDefaultMode(settings.subagent_default_mode));
    setSubagentConfigId(settings.subagent_default_config_id ?? null);
    setSubagentModel(settings.subagent_default_model?.model ?? null);
    setSubagentModelParamsJson(
      settings.subagent_default_model?.model_params?.length
        ? JSON.stringify(settings.subagent_default_model.model_params)
        : null
    );
    setUtilityConfigId(settings.utility_default_config_id ?? null);
    setUtilityModel(settings.utility_default_model?.model ?? null);
    setUtilityModelParamsJson(
      settings.utility_default_model?.model_params?.length
        ? JSON.stringify(settings.utility_default_model.model_params)
        : null
    );
    setDefaultUsageLimitAction(settings.default_usage_limit_action ?? DEFAULT_USAGE_LIMIT_ACTION);
    setDefaultUsageLimitText(usageLimitInputText(settings.default_usage_limit));
  }, [settings]);

  useEffect(() => {
    hydrateFromSettings();
  }, [hydrateFromSettings]);

  const buildModelPayload = (model, paramsJson) => {
    if (!model) return null;
    let model_params = null;
    if (paramsJson) {
      try {
        model_params = typeof paramsJson === 'string' ? JSON.parse(paramsJson) : paramsJson;
      } catch {
        model_params = null;
      }
    }
    if (!Array.isArray(model_params) || !model_params.length) model_params = null;
    return { model, model_params };
  };

  const flashSaved = (section) => {
    setSavedSection(section);
    setTimeout(() => setSavedSection(null), 2000);
  };

  const patchSection = async (section, payload, errorLabel) => {
    if (!user?.id) return;
    setSavingSection(section);
    setSavedSection(null);
    try {
      const updated = await usersService.patch(user.id, payload);
      onSave(updated);
      flashSaved(section);
    } catch (err) {
      toastError(errorLabel, err);
    } finally {
      setSavingSection(null);
    }
  };

  const saveSessionModels = () =>
    patchSection(
      'session',
      {
        agent_default_config_id: agentConfigId,
        agent_default_model: agentConfigId
          ? buildModelPayload(agentModel, agentModelParamsJson)
          : null,
        reviewer_default_config_id: reviewerConfigId,
        reviewer_default_model: reviewerConfigId
          ? buildModelPayload(reviewerModel, reviewerModelParamsJson)
          : null,
        utility_default_config_id: utilityConfigId,
        utility_default_model: utilityConfigId
          ? buildModelPayload(utilityModel, utilityModelParamsJson)
          : null,
      },
      'Failed to save session models'
    );

  const clearSessionModels = () =>
    patchSection(
      'session',
      {
        agent_default_config_id: null,
        agent_default_model: null,
        reviewer_default_config_id: null,
        reviewer_default_model: null,
        utility_default_config_id: null,
        utility_default_model: null,
      },
      'Failed to clear session models'
    );

  const saveMcpModels = () =>
    patchSection(
      'mcp',
      {
        subagent_default_mode: subagentMode,
        subagent_default_config_id: subagentMode === 'config' ? subagentConfigId : null,
        subagent_default_model:
          subagentMode === 'config' && subagentConfigId
            ? buildModelPayload(subagentModel, subagentModelParamsJson)
            : null,
      },
      'Failed to save MCP models'
    );

  const clearMcpModels = () =>
    patchSection(
      'mcp',
      {
        subagent_default_mode: SUBAGENT_DEFAULT_INHERIT,
        subagent_default_config_id: null,
        subagent_default_model: null,
      },
      'Failed to clear MCP models'
    );

  const saveSessionOptions = () => {
    const usageLimit = parseUsageLimit(defaultUsageLimitText);
    if (defaultUsageLimitAction === 'continue' && usageLimit === undefined) {
      toastError(
        'Invalid overage usage limit',
        new Error('Overage usage limit must be a dollar amount >= 0, or empty for unlimited')
      );
      return;
    }
    patchSection(
      'options',
      {
        default_usage_limit_action: defaultUsageLimitAction,
        default_usage_limit: defaultUsageLimitAction === 'continue' ? usageLimit : null,
      },
      'Failed to save session options'
    );
  };

  const clearSessionOptions = () =>
    patchSection(
      'options',
      {
        default_usage_limit_action: null,
        default_usage_limit: null,
      },
      'Failed to clear session options'
    );

  if (configsLoading) {
    return <p className="text-sm text-faint">Loading configurations…</p>;
  }

  const busy = savingSection != null;

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Session models"
        description="Default builder and reviewer models for the dashboard, and the utility model for naming sessions, branches, and other small jobs."
      >
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border border-line bg-control/30 p-4">
            <div>
              <h4 className="text-sm font-medium text-fg">Utility model</h4>
              <p className="text-xs text-faint mt-0.5">
                Leave unset to name with the session&apos;s builder model.
              </p>
            </div>
            <AgentDefaultModelPicker
              configId={utilityConfigId}
              onConfigIdChange={setUtilityConfigId}
              model={utilityModel}
              modelParamsJson={utilityModelParamsJson}
              onModelChange={setUtilityModel}
              onModelParamsJsonChange={setUtilityModelParamsJson}
              inheritLabel="Session's builder model"
              showInheritPlaceholder
            />
          </div>
          <DefaultAgentPicker
            title="Builder default"
            description="Pre-fills the dashboard builder. MCP agents use it for new sessions and loops when MCP models is set to inherit the default."
            inheritLabel="Use last session's model"
            inheritModeDescription="No account default; pre-fill from your most recent session."
            configId={agentConfigId}
            onConfigIdChange={setAgentConfigId}
            model={agentModel}
            modelParamsJson={agentModelParamsJson}
            onModelChange={setAgentModel}
            onModelParamsJsonChange={setAgentModelParamsJson}
            modelModeRadioName="builder-default-model-mode"
          />
          <DefaultAgentPicker
            title="Reviewer default"
            description="Pre-fills the Issues reviewer when a session has no review model yet."
            inheritLabel="Inherit from session"
            inheritModeDescription="No account default; pre-fill from the session's primary builder model."
            configId={reviewerConfigId}
            onConfigIdChange={setReviewerConfigId}
            model={reviewerModel}
            modelParamsJson={reviewerModelParamsJson}
            onModelChange={setReviewerModel}
            onModelParamsJsonChange={setReviewerModelParamsJson}
            modelModeRadioName="reviewer-default-model-mode"
          />
        </div>
        <SectionActions
          saving={savingSection === 'session'}
          saved={savedSection === 'session'}
          onSave={saveSessionModels}
          onClear={clearSessionModels}
          disabled={busy && savingSection !== 'session'}
        />
      </SettingsSection>

      <SettingsSection
        title="MCP models"
        description="Which models agents may use when they create sessions, loops, or subagents through MCP tools."
      >
        <SubagentDefaultPicker
          embedded
          mode={subagentMode}
          onModeChange={setSubagentMode}
          configId={subagentConfigId}
          onConfigIdChange={setSubagentConfigId}
          model={subagentModel}
          modelParamsJson={subagentModelParamsJson}
          onModelChange={setSubagentModel}
          onModelParamsJsonChange={setSubagentModelParamsJson}
        />
        <SectionActions
          saving={savingSection === 'mcp'}
          saved={savedSection === 'mcp'}
          onSave={saveMcpModels}
          onClear={clearMcpModels}
          disabled={busy && savingSection !== 'mcp'}
        />
      </SettingsSection>

      <SettingsSection
        title="Session options"
        description="Default usage-limit policy for new sessions and loops in the dashboard and via MCP when usage fields are omitted."
      >
        <DefaultUsageLimitsFields
          action={defaultUsageLimitAction}
          onActionChange={setDefaultUsageLimitAction}
          limitText={defaultUsageLimitText}
          onLimitTextChange={setDefaultUsageLimitText}
        />
        <SectionActions
          saving={savingSection === 'options'}
          saved={savedSection === 'options'}
          onSave={saveSessionOptions}
          onClear={clearSessionOptions}
          disabled={busy && savingSection !== 'options'}
        />
      </SettingsSection>
    </div>
  );
}
