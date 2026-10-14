import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { agentModelPresetsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';
import DefaultAgentPicker from '../../components/settings/DefaultAgentPicker.jsx';
import Modal, { ModalActions, ModalHeader } from '../../components/Modal.jsx';
import { DANGER_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';

function PresetFormModal({ open, preset, onClose, onSaved, configOptions }) {
  const [description, setDescription] = useState('');
  const [configId, setConfigId] = useState(null);
  const [model, setModel] = useState(null);
  const [modelParamsJson, setModelParamsJson] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDescription(preset?.description ?? '');
    setConfigId(preset?.agent_config_id ?? null);
    setModel(preset?.model ?? null);
    setModelParamsJson(preset?.model_params?.length ? JSON.stringify(preset.model_params) : null);
  }, [open, preset]);

  const canSave = description.trim() && configId != null && model && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const payload = {
      description: description.trim(),
      agent_config_id: configId,
      model,
      ...(modelParamsJson ? { model_params: JSON.parse(modelParamsJson) } : {}),
    };
    try {
      if (preset?.id) {
        await agentModelPresetsService.patch(preset.id, payload);
      } else {
        await agentModelPresetsService.create(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      toastError('Failed to save preset model', err);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal onClose={onClose}>
      <ModalHeader title={preset ? 'Edit preset model' : 'Add preset model'} onClose={onClose} />
      <div className="space-y-4 p-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-faint">Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. use to build clearly defined todos"
            className="w-full rounded-lg border border-line bg-control px-3 py-2 text-sm text-heading"
          />
        </label>
        <DefaultAgentPicker
          title="Agent configuration and model"
          description="SDK comes from the configuration you pick."
          inheritLabel="Select a configuration"
          configId={configId}
          onConfigIdChange={setConfigId}
          model={model}
          modelParamsJson={modelParamsJson}
          onModelChange={setModel}
          onModelParamsJsonChange={setModelParamsJson}
          configOptions={configOptions}
          allowInherit={false}
        />
      </div>
      <ModalActions>
        <button type="button" className={DANGER_BUTTON_CLASS} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className={PRIMARY_BUTTON_SIZED}
          disabled={!canSave}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </ModalActions>
    </Modal>
  );
}

export default function AgentPresetModelsSection() {
  const { configOptions, loading: configsLoading } = useAgentConfigs();
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    return agentModelPresetsService
      .find()
      .then((res) => setPresets(res.data ?? []))
      .catch((err) => toastError('Failed to load preset models', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this preset model?')) return;
    setDeletingId(id);
    try {
      await agentModelPresetsService.remove(id);
      await reload();
    } catch (err) {
      toastError('Failed to delete preset model', err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-faint">
          Named SDK / model / parameter combos for MCP tools and session agents.
        </p>
        <button
          type="button"
          className={PRIMARY_BUTTON_SIZED}
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          disabled={configsLoading || !configOptions.length}
        >
          <Plus className="w-3.5 h-3.5" />
          Add preset
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-faint">Loading preset models…</p>
      ) : presets.length === 0 ? (
        <p className="text-sm text-faint">No preset models yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {presets.map((preset) => (
            <li key={preset.id} className="flex items-start gap-3 px-3 py-2.5 hover:bg-control/30">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-heading">{preset.description}</p>
                <p className="text-xs text-faint mt-0.5">
                  {formatAgentSdkDisplayName(preset.agent_sdk)} · {preset.model}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  title="Edit"
                  className="p-1.5 text-faint hover:text-heading"
                  onClick={() => {
                    setEditing(preset);
                    setModalOpen(true);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  disabled={deletingId === preset.id}
                  className="p-1.5 text-faint hover:text-danger"
                  onClick={() => handleDelete(preset.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <PresetFormModal
        open={modalOpen}
        preset={editing}
        configOptions={configOptions}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSaved={reload}
      />
    </div>
  );
}
