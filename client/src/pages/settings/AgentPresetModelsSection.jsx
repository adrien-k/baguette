import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { agentModelPresetsService } from '../../feathers.js';
import { agentModelPresetKeys } from '../../queries/keys.js';
import { toastError } from '../../utils/toastError.jsx';
import { useAgentConfigs } from '../../hooks/useAgentConfigs.js';
import { useAgentModelPresets } from '../../hooks/useAgentModelPresets.js';
import DefaultAgentPicker from '../../components/settings/DefaultAgentPicker.jsx';
import Modal, { ModalActions, ModalHeader } from '../../components/Modal.jsx';
import Toggle from '../../components/Toggle.jsx';
import { DANGER_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';

const CHECKBOX_CLASS = 'rounded border-strong text-accent focus:ring-brand/50';

function ScopeCheckbox({ checked, onChange, title, children }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-secondary" title={title}>
      <input type="checkbox" className={CHECKBOX_CLASS} checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}

function formatEnabledModes(preset) {
  const modes = [];
  if (preset.for_subagents) modes.push('Subagents');
  if (preset.for_new_sessions) modes.push('New sessions');
  return modes.length ? `Enables: ${modes.join(' · ')}` : 'Enables: none';
}

function PresetFormModal({ open, preset, onClose, onSaved }) {
  const [description, setDescription] = useState('');
  const [configId, setConfigId] = useState(null);
  const [model, setModel] = useState(null);
  const [modelParamsJson, setModelParamsJson] = useState(null);
  const [forSubagents, setForSubagents] = useState(true);
  const [forNewSessions, setForNewSessions] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDescription(preset?.description ?? '');
    setConfigId(preset?.agent_config_id ?? null);
    setModel(preset?.model ?? null);
    setModelParamsJson(preset?.model_params?.length ? JSON.stringify(preset.model_params) : null);
    setForSubagents(preset ? Boolean(preset.for_subagents) : true);
    setForNewSessions(preset ? Boolean(preset.for_new_sessions) : true);
  }, [open, preset]);

  const canSave = description.trim() && configId != null && model && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const payload = {
      description: description.trim(),
      agent_config_id: configId,
      model,
      for_subagents: forSubagents,
      for_new_sessions: forNewSessions,
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
          allowInherit={false}
        />
        <div className="space-y-1">
          <span className="text-xs font-medium text-faint">Usable by</span>
          <div className="flex gap-4">
            <ScopeCheckbox
              checked={forSubagents}
              onChange={(e) => setForSubagents(e.target.checked)}
              title="Agents can pick this preset when starting subagents."
            >
              Subagents
            </ScopeCheckbox>
            <ScopeCheckbox
              checked={forNewSessions}
              onChange={(e) => setForNewSessions(e.target.checked)}
              title="Agents can pick this preset when creating new sessions and loops."
            >
              New sessions
            </ScopeCheckbox>
          </div>
        </div>
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
  const { presets, loading } = useAgentModelPresets();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const invalidatePresets = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: agentModelPresetKeys.all,
      refetchType: 'active',
    });
  }, [queryClient]);

  const patchFlag = useMutation({
    mutationFn: ({ id, field, value }) => agentModelPresetsService.patch(id, { [field]: value }),
    // Flip the row optimistically so the toggle reacts instantly; the SSE
    // patch event plus the settle invalidation reconcile with the server row.
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({ queryKey: agentModelPresetKeys.all });
      queryClient.setQueryData(agentModelPresetKeys.list(), (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, [field]: value } : row))
      );
    },
    onError: (err) => toastError('Failed to update preset model', err),
    onSettled: invalidatePresets,
  });

  const removePreset = useMutation({
    mutationFn: (id) => agentModelPresetsService.remove(id),
    onError: (err) => toastError('Failed to delete preset model', err),
    onSettled: invalidatePresets,
  });

  const handlePatchFlag = (preset, field, value) => {
    setBusyId(preset.id);
    patchFlag.mutate({ id: preset.id, field, value }, { onSettled: () => setBusyId(null) });
  };

  const handleDelete = (id) => {
    if (!window.confirm('Delete this preset model?')) return;
    setDeletingId(id);
    removePreset.mutate(id, { onSettled: () => setDeletingId(null) });
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
            <li
              key={preset.id}
              className={`flex items-start gap-3 px-3 py-2.5 hover:bg-control/30 ${
                preset.enabled ? '' : 'opacity-60'
              }`}
            >
              <Toggle
                checked={Boolean(preset.enabled)}
                disabled={busyId === preset.id}
                onChange={(value) => handlePatchFlag(preset, 'enabled', value)}
                title={preset.enabled ? 'Turn preset off' : 'Turn preset on'}
                aria-label={`Toggle ${preset.description}`}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-heading">{preset.description}</p>
                  {!preset.enabled ? (
                    <span className="shrink-0 rounded bg-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary">
                      Off
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-faint">
                  {formatAgentSdkDisplayName(preset.agent_sdk)} · {preset.model}
                </p>
                <p className="mt-0.5 text-xs text-secondary">{formatEnabledModes(preset)}</p>
              </div>
              <div className="flex shrink-0 gap-1 pt-0.5">
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
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSaved={invalidatePresets}
      />
    </div>
  );
}
