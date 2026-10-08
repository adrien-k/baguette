import { useEffect, useMemo, useState } from 'react';
import Modal, { ModalActions, ModalHeader } from '../../components/Modal.jsx';
import DefaultAgentPicker from '../../components/settings/DefaultAgentPicker.jsx';
import { DANGER_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import { TEXT_MUTED, TEXT_PRIMARY } from '../../utils/ui.js';
import { localStateFromConfigDefault } from '../../utils/agentConfigDefaultModel.js';

function needsBuilderReplacement(references) {
  const b = references?.builder ?? {};
  return (b.sessions ?? 0) > 0 || (b.loops ?? 0) > 0 || b.user_default;
}

function needsReviewerReplacement(references) {
  const r = references?.reviewer ?? {};
  return (r.sessions ?? 0) > 0 || r.user_default;
}

function buildModelPayload(model, paramsJson) {
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
}

function initialPickerState(configOptions, excludeId) {
  const first = configOptions.find((c) => Number(c.key) !== Number(excludeId));
  if (!first) return { configId: null, model: null, modelParamsJson: null };
  const { model, modelParamsJson } = localStateFromConfigDefault(first);
  return {
    configId: Number(first.key),
    model: model || null,
    modelParamsJson,
  };
}

export default function AgentConfigDeleteReplacementModal({
  config,
  references,
  configOptions,
  deleting,
  onClose,
  onConfirm,
}) {
  const needBuilder = needsBuilderReplacement(references);
  const needReviewer = needsReviewerReplacement(references);

  const [builderConfigId, setBuilderConfigId] = useState(null);
  const [builderModel, setBuilderModel] = useState(null);
  const [builderParamsJson, setBuilderParamsJson] = useState(null);
  const [reviewerConfigId, setReviewerConfigId] = useState(null);
  const [reviewerModel, setReviewerModel] = useState(null);
  const [reviewerParamsJson, setReviewerParamsJson] = useState(null);

  const availableOptions = useMemo(
    () => configOptions.filter((c) => Number(c.key) !== Number(config.id)),
    [configOptions, config.id]
  );

  useEffect(() => {
    const initial = initialPickerState(configOptions, config.id);
    if (needBuilder) {
      setBuilderConfigId(initial.configId);
      setBuilderModel(initial.model);
      setBuilderParamsJson(initial.modelParamsJson);
    }
    if (needReviewer) {
      setReviewerConfigId(initial.configId);
      setReviewerModel(initial.model);
      setReviewerParamsJson(initial.modelParamsJson);
    }
  }, [config.id, configOptions, needBuilder, needReviewer]);

  const builderReady = !needBuilder || (builderConfigId != null && builderModel);
  const reviewerReady = !needReviewer || (reviewerConfigId != null && reviewerModel);
  const canConfirm = builderReady && reviewerReady && availableOptions.length > 0;

  const usageSummary = useMemo(() => {
    const parts = [];
    const b = references?.builder ?? {};
    const r = references?.reviewer ?? {};
    if (b.sessions) parts.push(`${b.sessions} session(s) as builder`);
    if (b.loops) parts.push(`${b.loops} loop(s)`);
    if (b.user_default) parts.push('your builder default');
    if (r.sessions) parts.push(`${r.sessions} session(s) as reviewer`);
    if (r.user_default) parts.push('your reviewer default');
    return parts.join(', ');
  }, [references]);

  const handleConfirm = () => {
    const payload = { id: config.id };
    if (needBuilder) {
      payload.builder_replacement = {
        agent_config_id: builderConfigId,
        ...buildModelPayload(builderModel, builderParamsJson),
      };
    }
    if (needReviewer) {
      payload.reviewer_replacement = {
        agent_config_id: reviewerConfigId,
        ...buildModelPayload(reviewerModel, reviewerParamsJson),
      };
    }
    onConfirm(payload);
  };

  return (
    <Modal maxWidth="max-w-lg" padding="p-5">
      <ModalHeader title="Replace before delete" onClose={onClose} disabled={deleting} />
      <p className={`${TEXT_MUTED} text-sm mb-4`}>
        <strong className={TEXT_PRIMARY}>{config.label}</strong> is still used ({usageSummary}).
        Choose replacements, then delete.
      </p>
      {availableOptions.length === 0 ? (
        <p className="text-sm text-danger">
          Add another agent configuration first — you cannot delete the only one while it is in use.
        </p>
      ) : (
        <div className="space-y-3 max-h-[min(60vh,28rem)] overflow-y-auto pr-1">
          {needBuilder ? (
            <DefaultAgentPicker
              title="Builder replacement"
              description="Applied to sessions, loops, and your builder default that used this configuration."
              inheritLabel="Select configuration"
              configId={builderConfigId}
              onConfigIdChange={setBuilderConfigId}
              model={builderModel}
              modelParamsJson={builderParamsJson}
              onModelChange={setBuilderModel}
              onModelParamsJsonChange={setBuilderParamsJson}
              configOptions={configOptions}
              excludeConfigId={config.id}
              allowInherit={false}
            />
          ) : null}
          {needReviewer ? (
            <DefaultAgentPicker
              title="Reviewer replacement"
              description="Applied to sessions and your reviewer default that used this configuration."
              inheritLabel="Select configuration"
              configId={reviewerConfigId}
              onConfigIdChange={setReviewerConfigId}
              model={reviewerModel}
              modelParamsJson={reviewerParamsJson}
              onModelChange={setReviewerModel}
              onModelParamsJsonChange={setReviewerParamsJson}
              configOptions={configOptions}
              excludeConfigId={config.id}
              allowInherit={false}
            />
          ) : null}
        </div>
      )}
      <ModalActions className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={deleting}
          className="px-4 py-2 text-sm text-secondary hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={deleting || !canConfirm}
          className={DANGER_BUTTON_CLASS}
        >
          {deleting ? 'Deleting…' : 'Replace and delete'}
        </button>
      </ModalActions>
    </Modal>
  );
}
