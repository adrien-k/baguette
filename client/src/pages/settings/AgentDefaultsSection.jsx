import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { usersService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';
import DefaultAgentPicker from '../../components/settings/DefaultAgentPicker.jsx';
import { SettingsSaveRow } from '../../components/SettingsSection.jsx';

export default function AgentDefaultsSection({ settings, onSave }) {
  const { user } = useAuth();
  const { configOptions, loading: configsLoading } = useAgentConfigs();

  const [agentConfigId, setAgentConfigId] = useState(null);
  const [agentModel, setAgentModel] = useState(null);
  const [agentModelParamsJson, setAgentModelParamsJson] = useState(null);

  const [reviewerConfigId, setReviewerConfigId] = useState(null);
  const [reviewerModel, setReviewerModel] = useState(null);
  const [reviewerModelParamsJson, setReviewerModelParamsJson] = useState(null);

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
        configId={agentConfigId}
        onConfigIdChange={setAgentConfigId}
        model={agentModel}
        modelParamsJson={agentModelParamsJson}
        onModelChange={setAgentModel}
        onModelParamsJsonChange={setAgentModelParamsJson}
        configOptions={configOptions}
      />
      <DefaultAgentPicker
        title="Reviewer default"
        description="Pre-fills the reviewer panel when a session has no review model yet."
        inheritLabel="Use session's model"
        configId={reviewerConfigId}
        onConfigIdChange={setReviewerConfigId}
        model={reviewerModel}
        modelParamsJson={reviewerModelParamsJson}
        onModelChange={setReviewerModel}
        onModelParamsJsonChange={setReviewerModelParamsJson}
        configOptions={configOptions}
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
