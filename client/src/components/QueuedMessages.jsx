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
    <div className="flex flex-col gap-1.5 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-amber-400/80 font-medium">
        <Clock className="w-3 h-3" />
        {isScheduled ? (sendAtLabel ? `Sends ${sendAtLabel}` : 'Scheduled') : 'Queued'}
        {hasFiles && <span className="text-zinc-500">· with attachment</span>}
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-600 rounded px-2.5 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none"
          />
          <div className="flex gap-1.5 justify-end">
            <button
              type="button"
              onClick={cancelEdit}
              className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={!editText.trim() && !hasFiles}
              className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 rounded text-xs font-medium transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm text-zinc-300 line-clamp-2 break-words min-w-0 whitespace-pre-wrap">
            {text || <span className="text-zinc-500 italic">No text</span>}
          </p>
          <div className="flex gap-0.5 shrink-0 -mt-0.5">
            <button
              type="button"
              onClick={startEdit}
              title="Edit"
              className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              title="Delete"
              className="p-1.5 text-zinc-500 hover:text-red-400 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onSendNow(item)}
              title="Send now"
              className="p-1.5 text-zinc-500 hover:text-amber-400 rounded transition-colors"
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
    <div className="flex flex-col gap-2 px-3 sm:px-4 pb-1">
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
