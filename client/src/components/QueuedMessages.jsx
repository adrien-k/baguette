import { useState } from 'react';
import { Clock, Pencil, Trash2, Send, Check, X } from 'lucide-react';
import { resolveTurnModel } from '@baguette/shared/turn-model.js';
import MessageTurnModelBadge from './chat/MessageTurnModelBadge.jsx';
import {
  queuedMessageHasAttachments,
  readQueuedMessageBlocks,
  readQueuedMessageText,
  rebuildQueuedMessageJson,
} from '../utils/queuedMessagePayload.js';
import UserMessageContent from './chat/UserMessageContent.tsx';
import ComposerTextarea from './ComposerTextarea.jsx';
import { formatMonthDayTime } from '../utils/dates.js';

function QueuedItem({ item, session, agentType, onDelete, onSendNow, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const text = readQueuedMessageText(item.message_json);
  const blocks = readQueuedMessageBlocks(item.message_json);
  const hasFiles = queuedMessageHasAttachments(item.message_json);
  const showBlockPreview = blocks.some((b) => b?.type === 'file_reference');
  const isScheduled = item.kind === 'scheduled';
  const sendAtLabel = isScheduled ? formatMonthDayTime(item.send_at) || null : null;
  const { model, modelParams } = resolveTurnModel(item, session);
  const agentConfigId = item.agent_config_id ?? null;

  const startEdit = () => {
    setEditText(text);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = () => {
    if (!editText.trim() && !hasFiles) return;
    onEdit(item.id, rebuildQueuedMessageJson(item.message_json, editText.trim()));
    setEditing(false);
  };

  const canSaveEdit = Boolean(editText.trim()) || hasFiles;

  return (
    <div className="flex flex-col gap-1.5 bg-control/60 border border-strong/60 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-accent/80 font-medium min-w-0">
        <Clock className="w-3 h-3 shrink-0" />
        <span className="truncate">
          {isScheduled ? (sendAtLabel ? `Sends ${sendAtLabel}` : 'Scheduled') : 'Queued'}
          {hasFiles && <span className="text-faint"> · with attachment</span>}
        </span>
        <MessageTurnModelBadge
          agentType={agentType}
          model={model}
          modelParams={modelParams}
          agentConfigId={agentConfigId}
          className="text-faint font-normal shrink-0 ml-auto"
        />
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <ComposerTextarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onSubmit={saveEdit}
            canSubmit={canSaveEdit}
            rows={3}
            maxLines={12}
            className="w-full bg-nav border border-strong rounded px-2.5 py-1.5 text-sm text-fg placeholder-faint focus:outline-none focus:ring-2 focus:ring-brand/50 resize-none"
          />
          <div className="flex gap-1.5 justify-end">
            <button
              type="button"
              onClick={cancelEdit}
              className="flex items-center gap-1 px-2 py-1 text-xs text-fg-muted hover:text-heading transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={!editText.trim() && !hasFiles}
              className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand rounded text-xs font-medium transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0 line-clamp-3">
            {showBlockPreview ? (
              <UserMessageContent
                content={blocks}
                markdown={false}
                textClassName="text-sm text-secondary whitespace-pre-wrap break-words"
              />
            ) : (
              <p className="text-sm text-secondary break-words whitespace-pre-wrap">
                {text || <span className="text-faint italic">No text</span>}
              </p>
            )}
          </div>
          <div className="flex gap-0.5 shrink-0 -mt-0.5">
            <button
              type="button"
              onClick={startEdit}
              title="Edit"
              className="p-1.5 text-faint hover:text-secondary rounded transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              title="Delete"
              className="p-1.5 text-faint hover:text-danger rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onSendNow(item)}
              title="Send now"
              className="p-1.5 text-faint hover:text-accent rounded transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Queued & scheduled messages list.
 *
 * @param {object} props
 * @param {Array<Record<string, unknown>>} props.queue
 * @param {Record<string, unknown>|null} [props.session]
 * @param {(id: number) => unknown} [props.onDelete]
 * @param {(id: number) => unknown} [props.onSendNow]
 * @param {(id: number, messageJson: string) => unknown} [props.onEdit]
 */
export default function QueuedMessages({ queue, session, agentType, onDelete, onSendNow, onEdit }) {
  if (!queue.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {queue.map((item) => (
        <QueuedItem
          key={item.id}
          item={item}
          session={session}
          agentType={agentType}
          onDelete={onDelete}
          onSendNow={onSendNow}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
