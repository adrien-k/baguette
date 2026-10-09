import { ansiToHtml } from '../../utils/ansi.js';

const TERMINAL_PRE_CLASS =
  'ansi-log font-mono text-xs whitespace-pre overflow-x-auto overflow-y-auto max-h-80 max-w-full rounded p-2';

/** Render command/stdout/stderr text as an ANSI-styled terminal log. */
export default function TerminalLogBlock({
  label,
  text,
  ansi = true,
}: {
  label?: string | null;
  text?: string | null;
  ansi?: boolean;
}) {
  if (text == null || text === '') return null;
  const html = ansi ? ansiToHtml(text) : null;
  return (
    <div className="min-w-0 max-w-full">
      {label ? <div className="text-faint font-medium mb-1">{label}</div> : null}
      {html ? (
        <pre className={TERMINAL_PRE_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className={TERMINAL_PRE_CLASS}>{text}</pre>
      )}
    </div>
  );
}
