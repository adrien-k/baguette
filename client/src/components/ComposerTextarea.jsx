import AutoGrowTextarea from './AutoGrowTextarea.jsx';
import { handleComposerEnterKeyDown } from '../utils/composerEnterSubmit.js';

/**
 * Auto-growing textarea with chat-composer key handling built in:
 * Enter submits on desktop, Shift+Enter inserts a newline (mobile Enter
 * stays a newline). All other props forward to {@link AutoGrowTextarea}.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(e: import('react').ChangeEvent<HTMLTextAreaElement>) => void} props.onChange
 * @param {(e: import('react').KeyboardEvent<HTMLTextAreaElement>) => void} [props.onSubmit]
 *   Called on Enter when submission is allowed.
 * @param {boolean} [props.canSubmit] Gate for Enter-to-submit; defaults to non-empty trimmed value.
 * @param {boolean} [props.disabled] Disables the textarea and Enter submission.
 * @param {(e: import('react').KeyboardEvent<HTMLTextAreaElement>) => void} [props.onKeyDown]
 *   Extra key handling; runs before submit handling and wins if it calls preventDefault.
 */
export default function ComposerTextarea({
  value,
  onChange,
  onSubmit,
  canSubmit,
  disabled = false,
  onKeyDown,
  ...rest
}) {
  const handleKeyDown = (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || !onSubmit) return;
    handleComposerEnterKeyDown(e, {
      disabled,
      canSubmit: canSubmit ?? Boolean(String(value ?? '').trim()),
      onSubmit,
    });
  };

  return (
    <AutoGrowTextarea
      value={value}
      onChange={onChange}
      disabled={disabled}
      onKeyDown={handleKeyDown}
      {...rest}
    />
  );
}
