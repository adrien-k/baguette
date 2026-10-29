import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { usersService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';
import DefaultAgentPicker from '../../components/settings/DefaultAgentPicker.jsx';
import SubagentDefaultPicker from '../../components/settings/SubagentDefaultPicker.jsx';
import {
  SUBAGENT_DEFAULT_INHERIT,
  normalizeSubagentDefaultMode,
} from '@baguette/shared/subagent-default-mode.js';
import { SettingsSaveRow } from '../../components/SettingsSection.jsx';

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

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await usersService.patch(user.id, {
        agent_default_config_id: agentConfigId,
        agent_default_model: agentConfigId
          ? buildModelPayload(agentModel, agentModelParamsJson)
          : null,
        reviewer_default_config_id: reviewerConfigId,
        reviewer_default_model: reviewerConfigId
          ? buildModelPayload(reviewerModel, reviewerModelParamsJson)
          : null,
        subagent_default_mode: subagentMode,
        subagent_default_config_id: subagentMode === 'config' ? subagentConfigId : null,
        subagent_default_model:
          subagentMode === 'config' && subagentConfigId
            ? buildModelPayload(subagentModel, subagentModelParamsJson)
            : null,
      });
      onSave(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toastError('Failed to save agent defaults', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!user?.id) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await usersService.patch(user.id, {
        agent_default_config_id: null,
        agent_default_model: null,
        reviewer_default_config_id: null,
        reviewer_default_model: null,
        subagent_default_mode: SUBAGENT_DEFAULT_INHERIT,
        subagent_default_config_id: null,
        subagent_default_model: null,
      });
      onSave(updated);
      hydrateFromSettings();
    } catch (err) {
      toastError('Failed to clear agent defaults', err);
    } finally {
      setSaving(false);
    }
  };

  if (configsLoading) {
    return <p className="text-sm text-faint">Loading configurations…</p>;
  }

  return (
    <div className="space-y-4">
      <DefaultAgentPicker
        title="Builder default"
        description="Pre-fills the dashboard builder and MCP CreateSession when you omit agent_config_id."
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
      <SubagentDefaultPicker
        description="How MCP StartSubagent resolves models."
        mode={subagentMode}
        onModeChange={setSubagentMode}
        configId={subagentConfigId}
        onConfigIdChange={setSubagentConfigId}
        model={subagentModel}
        modelParamsJson={subagentModelParamsJson}
        onModelChange={setSubagentModel}
        onModelParamsJsonChange={setSubagentModelParamsJson}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SettingsSaveRow saving={saving} saved={saved} onSave={handleSave} />
        <button
          type="button"
          onClick={handleClear}
          disabled={saving}
          className="text-xs text-faint hover:text-secondary disabled:opacity-50"
        >
          Clear defaults
        </button>
      </div>
    </div>
  );
}
