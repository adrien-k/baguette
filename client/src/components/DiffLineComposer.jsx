import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import AgentMessageComposer from './AgentMessageComposer.jsx';
import ComposerScheduleAddon from './ComposerScheduleAddon.jsx';
import ScheduleMessageModal from './ScheduleMessageModal.jsx';
import { messagesService, queuedMessagesService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { builderMessageCreateFields } from '../utils/messageCreateFields.js';
import { contentBlocksFromLineDraft } from '@baguette/shared/user-message-content.js';

/**
 * Inline chat composer shown under a clicked diff line (file ref is attached on send, not in the textarea).
 */
export default function DiffLineComposer({
  session,
  path,
  line,
  shortSha,
  change,
  models,
  cursorModelPrefs,
  onCursorModelPrefChange,
  onModelChange,
  onAgentConfigChange,
  agentConfigOptions,
  onClose,
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [composerModel, setComposerModel] = useState(session?.model ?? null);
  const [composerModelParams, setComposerModelParams] = useState(session?.model_params ?? null);

  useEffect(() => {
    setInput('');
  }, [path, line, shortSha, change]);

  useEffect(() => {
    setComposerModel(session?.model ?? null);
    setComposerModelParams(session?.model_params ?? null);
  }, [session?.id, session?.model, session?.model_params]);

  useEffect(() => {
    const el = document.getElementById('diff-line-composer');
    if (!el) return;
    const end = el.value.length;
    el.focus();
    el.setSelectionRange(end, end);
  }, [path, line]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isRunning = session?.status === 'running';
  const isProvisioning = session?.status === 'provisioning';
  const canSendDraft = Boolean(session?.id && !sending);
  const composerTurnFields = () =>
    builderMessageCreateFields(session, {
      model: composerModel,
      model_params: composerModelParams,
    });

  const handleComposerModelChange = (modelId, modelParamsJson) => {
    setComposerModel(modelId);
    setComposerModelParams(modelParamsJson ?? null);
    onModelChange?.(modelId, modelParamsJson);
  };

  const buildMessageJson = () =>
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: contentBlocksFromLineDraft(input, {
          path,
          line,
          short_sha: shortSha,
          change,
        }),
      },
    });

  const handleSend = async (e, { force = false } = {}) => {
    e?.preventDefault();
    if (!canSendDraft) return;
    setSending(true);
    try {
      await messagesService.create({
        session_id: session.id,
        type: 'user',
        message_json: buildMessageJson(),
        ...composerTurnFields(),
        ...(force ? { force: true } : {}),
      });
      onClose();
    } catch (err) {
      toastError('Failed to send message', err);
    } finally {
      setSending(false);
    }
  };

  const scheduleMessageAt = async (sendAtIso) => {
    if (!canSendDraft) return;
    setSending(true);
    try {
      await queuedMessagesService.schedule({
        session_id: session.id,
        message_json: buildMessageJson(),
        send_at: sendAtIso,
        ...composerTurnFields(),
      });
      setShowScheduleModal(false);
      toast.success('Message scheduled');
      onClose();
    } catch (err) {
      toastError('Failed to schedule message', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="border-y border-brand/30 bg-page px-3 py-2.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] text-faint">
          Message about <span className="font-mono text-fg-muted">{path}</span>
          <span className="text-faint">:{line}</span>
          {shortSha ? (
            <span className="text-faint">
              {' '}
              · commit <span className="font-mono text-fg-muted">{shortSha}</span>
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-faint hover:text-secondary"
          aria-label="Close composer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <AgentMessageComposer
        skipColumn
        formClassName=""
        value={input}
        onChange={setInput}
        onSubmit={handleSend}
        placeholder="Add a note for the agent…"
        sending={sending}
        agentConfigKey={
          session?.agent_config_id != null ? String(session.agent_config_id) : session?.agent_sdk
        }
        model={composerModel}
        params={composerModelParams}
        models={models}
        cursorModelPrefs={cursorModelPrefs}
        onCursorModelPrefChange={onCursorModelPrefChange}
        onModelChange={handleComposerModelChange}
        onAgentConfigChange={onAgentConfigChange}
        agentConfigOptions={agentConfigOptions}
        textareaId="diff-line-composer"
        autoFocus
        canSend={canSendDraft}
        submitLabel={isRunning || isProvisioning ? 'Queue' : 'Send'}
        sendAddon={
          <ComposerScheduleAddon
            disabled={!canSendDraft}
            onSendNow={
              isRunning || isProvisioning ? () => handleSend(undefined, { force: true }) : undefined
            }
            onPreset={(delayMs) => scheduleMessageAt(new Date(Date.now() + delayMs).toISOString())}
            onCustomSchedule={() => setShowScheduleModal(true)}
          />
        }
      />
      {showScheduleModal && (
        <ScheduleMessageModal
          scheduling={sending}
          onConfirm={(sendAtIso) => {
            const when = new Date(sendAtIso);
            if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
              toast.error('Pick a time in the future');
              return;
            }
            scheduleMessageAt(sendAtIso);
          }}
          onCancel={() => {
            if (!sending) setShowScheduleModal(false);
          }}
        />
      )}
    </div>
  );
}
