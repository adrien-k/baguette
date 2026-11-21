import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Sparkles } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import Field from './Field.jsx';
import TextInput from './TextInput.jsx';
import Tooltip from './Tooltip.jsx';
import AgentMessageComposer from './AgentMessageComposer.jsx';
import FileAttachmentPicker from './FileAttachmentPicker.jsx';
import { agentsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { TEXT_FAINT } from '../utils/ui.js';
import { titleFromPrompt } from '@baguette/shared/agent-naming.js';
import { useAgentConfigs } from '../hooks/useAgentConfigs.js';
import { useAgentConfigModels } from '../hooks/useAgentConfigModels.js';
import { useCursorModelPrefs } from '../hooks/useAgentPreferences.js';
import { defaultModelForSdk, paramsJsonForModelChange } from '../utils/models.js';
import { localStateFromConfigDefault } from '../utils/agentConfigDefaultModel.js';

const ADD_BUILDER_PLACEHOLDER =
  'Optional — leave empty to open the builder with no initial message';

function paramsJsonFromValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export default function StartSubagentModal({
  sessionId,
  initialPrompt = '',
  initialFiles = [],
  defaultLabel,
  recipes = [],
  initialAgentConfigId = null,
  initialModel = null,
  initialModelParams = null,
  onConfirm,
  onCancel,
  saving = false,
}) {
  const [label, setLabel] = useState(defaultLabel ?? titleFromPrompt(initialPrompt));
  const [prompt, setPrompt] = useState(initialPrompt);
  const [files, setFiles] = useState(() => (Array.isArray(initialFiles) ? [...initialFiles] : []));
  const [fileError, setFileError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [configId, setConfigId] = useState(
    initialAgentConfigId != null ? Number(initialAgentConfigId) : null
  );
  const [model, setModel] = useState(initialModel || null);
  const [modelParamsJson, setModelParamsJson] = useState(paramsJsonFromValue(initialModelParams));

  const { configOptions: agentConfigOptions, loading: configsLoading } = useAgentConfigs();
  const { models, stale: modelsStale } = useAgentConfigModels(configId, {
    enabled: configId != null,
  });
  const modelsLoading = modelsStale && !models.length;
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();

  const trimmedLabel = label.trim();
  const trimmedPrompt = prompt.trim();
  const busy = saving || generating;
  const canStart = Boolean(trimmedLabel) && !busy;
  const canGenerate = Boolean(trimmedPrompt) && !busy;

  const handleComposerModelChange = useCallback((modelId, paramsJson) => {
    setModel(modelId || null);
    setModelParamsJson(paramsJson ?? null);
  }, []);

  const handleAgentConfigChange = useCallback(
    (nextKey) => {
      const nextId = Number(nextKey);
      setConfigId(nextId);
      const picked = agentConfigOptions.find((c) => c.key === String(nextKey));
      const fromDefault = localStateFromConfigDefault(picked);
      setModel(fromDefault.model || null);
      setModelParamsJson(fromDefault.modelParamsJson);
    },
    [agentConfigOptions]
  );

  useEffect(() => {
    if (configId == null || modelsStale || !models.length) return;
    if (model && models.some((m) => m.id === model)) return;
    const fallback = defaultModelForSdk(models);
    if (!fallback) return;
    handleComposerModelChange(fallback.id, paramsJsonForModelChange(fallback, cursorModelPrefs));
  }, [configId, model, models, modelsStale, cursorModelPrefs, handleComposerModelChange]);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const result = await agentsService.generateName({
        prompt: trimmedPrompt,
        session_id: sessionId,
      });
      if (result?.name) setLabel(result.name);
    } catch (err) {
      toastError('Failed to generate label', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleRecipeSelect = useCallback((recipePrompt) => {
    setPrompt(recipePrompt);
    setLabel(titleFromPrompt(recipePrompt));
  }, []);

  const handleConfirm = async () => {
    if (!canStart || saving) return;
    setFileError(null);
    const result = await onConfirm({
      name: trimmedLabel,
      prompt: trimmedPrompt,
      agent_config_id: configId,
      model,
      model_params: modelParamsJson,
      files,
    });
    if (result?.ok === false && result.fileError) {
      setFileError(result.fileError);
    }
  };

  const handleAddFiles = (picked) => {
    setFileError(null);
    setFiles((prev) => [...prev, ...picked]);
  };

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Modal maxWidth="max-w-lg">
      <ModalHeader title="Add builder" icon={Bot} onClose={busy ? undefined : onCancel} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleConfirm();
        }}
      >
        <div className="space-y-4">
          <Field className="" label="Prompt">
            <FileAttachmentPicker
              className="w-full"
              files={files}
              onAdd={handleAddFiles}
              onRemove={handleRemoveFile}
              error={fileError}
            >
              {({ attachButton }) => (
                <AgentMessageComposer
                  skipColumn
                  formClassName=""
                  value={prompt}
                  onChange={setPrompt}
                  onSubmit={(e) => e.preventDefault()}
                  disableEnterSubmit
                  placeholder={ADD_BUILDER_PLACEHOLDER}
                  disabled={busy}
                  rows={2}
                  resizable
                  textareaId="add-builder-prompt"
                  agentConfigKey={configId != null ? String(configId) : null}
                  model={model || ''}
                  params={modelParamsJson}
                  models={configId != null ? models : []}
                  cursorModelPrefs={cursorModelPrefs}
                  onCursorModelPrefChange={setCursorModelPref}
                  onModelChange={handleComposerModelChange}
                  showAutoPushParam={false}
                  agentConfigOptions={agentConfigOptions}
                  onAgentConfigChange={handleAgentConfigChange}
                  configsLoading={configsLoading}
                  modelsLoading={modelsLoading}
                  showSubmitButton={false}
                  toolbarExtra={attachButton}
                  recipes={recipes}
                  onRecipeSelect={handleRecipeSelect}
                />
              )}
            </FileAttachmentPicker>
          </Field>
          <Field className="" label="Label">
            <div className="relative">
              <TextInput
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Builder name"
                maxLength={120}
                autoFocus
                disabled={busy}
                className="pr-10"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <Tooltip content="Generate a label from the prompt">
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={!canGenerate}
                    aria-label="Generate label"
                    className={`p-1.5 rounded-md ${TEXT_FAINT} hover:text-accent hover:bg-control disabled:opacity-40 disabled:pointer-events-none`}
                  >
                    {generating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </button>
                </Tooltip>
              </div>
            </div>
          </Field>
        </div>
        <ModalActions>
          <button type="button" onClick={onCancel} disabled={busy} className={GHOST_BUTTON_CLASS}>
            Cancel
          </button>
          <button type="submit" disabled={!canStart} className={PRIMARY_BUTTON_SIZED}>
            {saving ? 'Adding…' : 'Add builder'}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}
