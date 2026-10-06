import { useState } from 'react';
import { Clock, Pencil, Trash2, Send, Check, X } from 'lucide-react';
import { resolveTurnModel } from '@baguette/shared/turn-model.js';
import { messageModelLabel } from '../utils/messageModelLabel.js';
import {
  queuedMessageHasAttachments,
  readQueuedMessageText,
  rebuildQueuedMessageJson,
} from '../utils/queuedMessagePayload.js';

function formatSendAt(sendAt) {
  if (!sendAt) return null;
  try {
    return new Date(sendAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function QueuedItem({ item, session, models, onDelete, onSendNow, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const text = readQueuedMessageText(item.message_json);
  const hasFiles = queuedMessageHasAttachments(item.message_json);
  const isScheduled = item.kind === 'scheduled';
  const sendAtLabel = isScheduled ? formatSendAt(item.send_at) : null;
  const { model, modelParams } = resolveTurnModel(item, session);
  const turnModelLabel = messageModelLabel({ model, modelParams, models });

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

  return (
    <div className="flex flex-col gap-1.5 bg-control/60 border border-strong/60 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-accent/80 font-medium min-w-0">
        <Clock className="w-3 h-3 shrink-0" />
        <span className="truncate">
          {isScheduled ? (sendAtLabel ? `Sends ${sendAtLabel}` : 'Scheduled') : 'Queued'}
          {hasFiles && <span className="text-faint"> · with attachment</span>}
        </span>
        {turnModelLabel && (
          <span className="text-faint font-normal truncate max-w-[12rem] sm:max-w-xs shrink-0 ml-auto">
            {turnModelLabel}
          </span>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
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
          <p className="flex-1 text-sm text-secondary line-clamp-2 break-words min-w-0 whitespace-pre-wrap">
            {text || <span className="text-faint italic">No text</span>}
          </p>
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
 * @param {Array<{ id?: string, label?: string, name?: string }>} [props.models]
 * @param {(id: number) => unknown} [props.onDelete]
 * @param {(id: number) => unknown} [props.onSendNow]
 * @param {(id: number, messageJson: string) => unknown} [props.onEdit]
 */
export default function QueuedMessages({
  queue,
  session,
  models = [],
  onDelete,
  onSendNow,
  onEdit,
}) {
  if (!queue.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {queue.map((item) => (
        <QueuedItem
          key={item.id}
          item={item}
          session={session}
          models={models}
          onDelete={onDelete}
          onSendNow={onSendNow}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
