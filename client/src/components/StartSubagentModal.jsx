import { useState } from 'react';
import { BookOpen, Bot, Loader2, Sparkles } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import Field from './Field.jsx';
import TextInput from './TextInput.jsx';
import Tooltip from './Tooltip.jsx';
import ChatRecipeCarousel from './chat/ChatRecipeCarousel.tsx';
import { AgentDefaultModelPicker } from './settings/DefaultAgentPicker.jsx';
import { agentsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { INPUT_CLASS, TEXT_FAINT } from '../utils/ui.js';
import { titleFromPrompt } from '@baguette/shared/agent-naming.js';

function paramsJsonFromValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export default function StartSubagentModal({
  sessionId,
  initialPrompt = '',
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
  const [generating, setGenerating] = useState(false);
  const [configId, setConfigId] = useState(
    initialAgentConfigId != null ? Number(initialAgentConfigId) : null
  );
  const [model, setModel] = useState(initialModel || null);
  const [modelParamsJson, setModelParamsJson] = useState(paramsJsonFromValue(initialModelParams));

  const trimmedLabel = label.trim();
  const trimmedPrompt = prompt.trim();
  const busy = saving || generating;
  const canStart = Boolean(trimmedLabel) && !busy;
  const canGenerate = Boolean(trimmedPrompt) && !busy;

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

  const handleRecipeSelect = (recipePrompt) => {
    setPrompt(recipePrompt);
    setLabel(titleFromPrompt(recipePrompt));
  };

  const handleConfirm = () => {
    if (!canStart) return;
    onConfirm({
      name: trimmedLabel,
      prompt: trimmedPrompt,
      agent_config_id: configId,
      model,
      model_params: modelParamsJson,
    });
  };

  return (
    <Modal maxWidth="max-w-lg">
      <ModalHeader title="Add builder" icon={Bot} onClose={busy ? undefined : onCancel} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleConfirm();
        }}
      >
        <div className="space-y-4">
          <Field className="" label="Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Optional — leave empty to open the builder with no initial message"
              disabled={busy}
              rows={4}
              className={`${INPUT_CLASS} resize-y min-h-[5rem]`}
            />
            {recipes.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
                  <BookOpen className="w-3 h-3 shrink-0" aria-hidden />
                  Recipes
                </div>
                <ChatRecipeCarousel
                  recipes={recipes}
                  disabled={busy}
                  onSelect={handleRecipeSelect}
                />
              </div>
            ) : null}
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
          <Field className="" label="Model">
            <AgentDefaultModelPicker
              configId={configId}
              onConfigIdChange={setConfigId}
              model={model}
              modelParamsJson={modelParamsJson}
              onModelChange={setModel}
              onModelParamsJsonChange={setModelParamsJson}
              allowInherit={false}
            />
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
