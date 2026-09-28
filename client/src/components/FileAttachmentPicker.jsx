import { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * File attachment picker used in BuilderForm and ChatView.
 *
 * When `children` is provided, the picker wraps the input with the attach button
 * overlaid in the bottom-right corner and file chips below. Otherwise renders
 * inline (button + chips in a row).
 *
 * Props:
 *   files    - File[] currently selected
 *   onAdd    - (File[]) => void  called with newly picked files
 *   onRemove - (index) => void   called when user removes a file
 *   error    - string | null    file error message to display
 *   children - ReactNode | ((slot: { attachButton: ReactNode }) => ReactNode)
 *              input/composer to wrap, or render prop for custom toolbar layout
 *   className - string          optional class for the root wrapper
 */
export default function FileAttachmentPicker({
  files,
  onAdd,
  onRemove,
  error,
  children,
  className = '',
}) {
  const inputRef = useRef(null);

  const handleChange = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) onAdd(picked);
    e.target.value = '';
  };

  const chips = files.map((file, i) => (
    <div
      key={i}
      className="flex items-center gap-1.5 bg-control-hover/80 hover:bg-control-hover rounded-md px-2.5 py-1.5 text-xs text-secondary border border-strong/50 transition-colors"
    >
      <span className="truncate max-w-[160px]">{file.name}</span>
      <span className="text-faint shrink-0 tabular-nums">{formatSize(file.size)}</span>
      <button
        type="button"
        onClick={() => onRemove(i)}
        className="text-faint hover:text-heading transition-colors p-0.5 rounded hover:bg-track/50"
        aria-label={`Remove ${file.name}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  ));

  const triggerButton = (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="inline-flex items-center justify-center shrink-0 h-8 w-8 text-faint hover:text-secondary hover:bg-control-hover/60 transition-colors rounded-md"
      title="Attach files"
      aria-label="Attach files"
    >
      <Paperclip className="w-4 h-4" />
    </button>
  );

  const attachSlot = { attachButton: triggerButton };

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      className="hidden"
      onChange={handleChange}
      accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/*,.md,.txt,.csv,.json,.yaml,.yml,.toml,.xml,.html,.css,.js,.ts,.jsx,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.sh,.bash,.zsh"
    />
  );

  if (children) {
    const rendered = typeof children === 'function' ? children(attachSlot) : children;

    return (
      <div className={`relative flex flex-col min-w-0 ${className}`.trim()}>
        {hiddenInput}
        {(files.length > 0 || error) && (
          <div className="mb-2 flex flex-col gap-1">
            {files.length > 0 && <div className="flex flex-wrap gap-2">{chips}</div>}
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        )}
        {typeof children === 'function' ? (
          rendered
        ) : (
          <div className="relative">
            {rendered}
            <div className="absolute right-1 bottom-1">{triggerButton}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={className || undefined}>
      {hiddenInput}
      <div className="flex items-center gap-2">
        {triggerButton}
        {files.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>}
      </div>
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}
