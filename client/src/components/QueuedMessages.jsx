import { useState } from 'react';
import { Clock, Pencil, Trash2, Send, Check, X } from 'lucide-react';

function extractText(messageJson) {
  try {
    const parsed = JSON.parse(messageJson);
    const content = parsed.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n\n');
    }
  } catch {
    /* ignore */
  }
  return '';
}

function hasFileAttachments(messageJson) {
  try {
    const parsed = JSON.parse(messageJson);
    const content = parsed.message?.content;
    if (Array.isArray(content)) {
      return content.some((b) => b.type !== 'text');
    }
  } catch {
    /* ignore */
  }
  return false;
}

function rebuildMessageJson(messageJson, newText) {
  try {
    const parsed = JSON.parse(messageJson);
    const content = parsed.message?.content;
    if (typeof content === 'string') {
      parsed.message.content = newText;
    } else if (Array.isArray(content)) {
      const nonTextBlocks = content.filter((b) => b.type !== 'text');
      parsed.message.content = newText
        ? [{ type: 'text', text: newText }, ...nonTextBlocks]
        : nonTextBlocks;
    }
    return JSON.stringify(parsed);
  } catch {
    return messageJson;
  }
}

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

function QueuedItem({ item, onDelete, onSendNow, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const text = extractText(item.message_json);
  const hasFiles = hasFileAttachments(item.message_json);
  const isScheduled = item.kind === 'scheduled';
  const sendAtLabel = isScheduled ? formatSendAt(item.send_at) : null;

  const startEdit = () => {
    setEditText(text);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = () => {
    if (!editText.trim() && !hasFiles) return;
    onEdit(item.id, rebuildMessageJson(item.message_json, editText.trim()));
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-1.5 bg-control/60 border border-strong/60 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-accent/80 font-medium">
        <Clock className="w-3 h-3" />
        {isScheduled ? (sendAtLabel ? `Sends ${sendAtLabel}` : 'Scheduled') : 'Queued'}
        {hasFiles && <span className="text-faint">· with attachment</span>}
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

export default function QueuedMessages({ queue, onDelete, onSendNow, onEdit }) {
  if (!queue.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {queue.map((item) => (
        <QueuedItem
          key={item.id}
          item={item}
          onDelete={onDelete}
          onSendNow={onSendNow}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
