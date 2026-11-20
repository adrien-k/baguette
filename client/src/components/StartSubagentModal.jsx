import { useState } from 'react';
import { Bot, Loader2, Sparkles } from 'lucide-react';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import Field from './Field.jsx';
import TextInput from './TextInput.jsx';
import Tooltip from './Tooltip.jsx';
import { AgentDefaultModelPicker } from './settings/DefaultAgentPicker.jsx';
import { agentsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { TEXT_FAINT } from '../utils/ui.js';

function paramsJsonFromValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export default function StartSubagentModal({
  sessionId,
  prompt,
  defaultLabel,
  initialAgentConfigId = null,
  initialModel = null,
  initialModelParams = null,
  onConfirm,
  onCancel,
  saving = false,
}) {
  const [label, setLabel] = useState(defaultLabel);
  const [generating, setGenerating] = useState(false);
  const [configId, setConfigId] = useState(
    initialAgentConfigId != null ? Number(initialAgentConfigId) : null
  );
  const [model, setModel] = useState(initialModel || null);
  const [modelParamsJson, setModelParamsJson] = useState(paramsJsonFromValue(initialModelParams));

  const trimmedLabel = label.trim();
  const busy = saving || generating;
  const canStart = Boolean(trimmedLabel) && !busy;
  const canGenerate = Boolean(prompt?.trim()) && !busy;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const result = await agentsService.generateName({
        prompt,
        session_id: sessionId,
      });
      if (result?.name) setLabel(result.name);
    } catch (err) {
      toastError('Failed to generate label', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirm = () => {
    if (!canStart) return;
    onConfirm({
      name: trimmedLabel,
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
