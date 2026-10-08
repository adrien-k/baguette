import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { agentConfigsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { parseAgentDefaultModelJson } from '@baguette/shared/agent-default-model.js';
import AgentConfigLogo from '../../components/AgentConfigLogo.jsx';
import AgentConfigModal from './AgentConfigModal.jsx';
import AgentConfigDeleteReplacementModal from './AgentConfigDeleteReplacementModal.jsx';
import Modal, { ModalActions, ModalHeader } from '../../components/Modal.jsx';
import { DANGER_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import {
  agentConfigInUseReferences,
  isAgentConfigInUseError,
} from '../../utils/agentConfigDeleteErrors.js';
import {
  TEXT_FAINT,
  TEXT_HEADING,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '../../utils/ui.js';

function defaultModelLabel(config) {
  return parseAgentDefaultModelJson(config?.default_model).model;
}

export default function AgentConfigsList() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [replacementDelete, setReplacementDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const configOptions = useMemo(
    () =>
      configs.map((c) => ({
        key: String(c.id),
        label: c.label,
        sdk: c.sdk,
        logo: c.logo ?? null,
        default_model: c.default_model,
      })),
    [configs]
  );

  const reload = useCallback(() => {
    setLoading(true);
    return agentConfigsService
      .find()
      .then((res) => setConfigs(res.data ?? []))
      .catch((err) => toastError('Failed to load agent configurations', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (config) => {
    setEditing(config);
    setModalOpen(true);
  };

  const finishDeleteUi = (deletedId) => {
    if (editing?.id === deletedId) {
      setModalOpen(false);
      setEditing(null);
    }
    setConfirmDelete(null);
    setReplacementDelete(null);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await agentConfigsService.remove(confirmDelete.id);
      finishDeleteUi(confirmDelete.id);
      await reload();
    } catch (err) {
      if (isAgentConfigInUseError(err)) {
        const references = agentConfigInUseReferences(err);
        setReplacementDelete({ config: confirmDelete, references });
        setConfirmDelete(null);
      } else {
        toastError('Failed to delete agent configuration', err);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleReplacementConfirm = async (payload) => {
    setDeletingId(payload.id);
    try {
      await agentConfigsService.removeWithReplacement(payload);
      finishDeleteUi(payload.id);
      await reload();
    } catch (err) {
      toastError('Failed to delete agent configuration', err);
    } finally {
      setDeletingId(null);
    }
  };

  const modal = modalOpen ? (
    <AgentConfigModal
      onClose={() => setModalOpen(false)}
      config={editing}
      onSaved={() => reload()}
      onConfigUpdated={(updated) => {
        setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setEditing(updated);
      }}
      onDelete={editing?.id ? () => setConfirmDelete(editing) : undefined}
    />
  ) : null;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          className={`${PRIMARY_BUTTON_SIZED} py-1.5 inline-flex items-center gap-1.5`}
          onClick={openCreate}
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>
      {loading && !configs.length ? (
        <p className={`text-sm ${TEXT_FAINT}`}>Loading agent configurations…</p>
      ) : configs.length === 0 ? (
        <p className={`text-sm ${TEXT_FAINT}`}>
          No configurations yet. Add one to run Claude, Cursor, or Pi agents.
        </p>
      ) : (
        <div className="space-y-3">
          {configs.map((c) => {
            const model = defaultModelLabel(c);
            return (
              <div
                key={c.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-line bg-control/30 p-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div
                    className="flex shrink-0 items-center justify-center rounded-md border border-strong bg-control p-2"
                    aria-hidden
                  >
                    <AgentConfigLogo sdk={c.sdk} logo={c.logo ?? null} className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium ${TEXT_HEADING} truncate`}>{c.label}</div>
                    <div
                      className={`mt-0.5 flex flex-wrap sm:flex-nowrap sm:items-center gap-x-3 gap-y-1 text-xs min-w-0 ${TEXT_FAINT}`}
                    >
                      <span className="capitalize shrink-0">{c.sdk}</span>
                      <span className="flex min-w-0 max-w-full items-center gap-1.5">
                        <span className="shrink-0">Default model</span>
                        <span
                          className={`truncate min-w-0 ${model ? TEXT_SECONDARY : ''}`}
                          title={model || undefined}
                        >
                          {model || '—'}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className={`${TEXT_MUTED} hover:text-heading p-1.5`}
                    title="Edit"
                    onClick={() => openEdit(c)}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className={`${TEXT_MUTED} hover:text-danger p-1.5`}
                    title="Delete"
                    disabled={deletingId !== null}
                    onClick={() => setConfirmDelete(c)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {modal}
      {confirmDelete && !replacementDelete && (
        <Modal maxWidth="max-w-md" padding="p-5">
          <ModalHeader
            title="Delete agent configuration?"
            onClose={() => !deletingId && setConfirmDelete(null)}
            disabled={deletingId !== null}
          />
          <p className={`${TEXT_MUTED} text-sm mb-4`}>
            Permanently remove <strong className={TEXT_PRIMARY}>{confirmDelete.label}</strong>? If
            anything still references it, you will choose a replacement next.
          </p>
          <ModalActions className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              disabled={deletingId !== null}
              className="px-4 py-2 text-sm text-secondary hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteConfirm()}
              disabled={deletingId !== null}
              className={DANGER_BUTTON_CLASS}
            >
              {deletingId !== null ? 'Deleting…' : 'Delete'}
            </button>
          </ModalActions>
        </Modal>
      )}
      {replacementDelete ? (
        <AgentConfigDeleteReplacementModal
          config={replacementDelete.config}
          references={replacementDelete.references}
          configOptions={configOptions}
          deleting={deletingId === replacementDelete.config.id}
          onClose={() => !deletingId && setReplacementDelete(null)}
          onConfirm={handleReplacementConfirm}
        />
      ) : null}
    </div>
  );
}
