import { useState } from 'react';

/** Quiet one-line tool block: read-only tools, MCP ops, and other low-noise calls. */

export function hasToolInput(input: unknown): boolean {
  return input != null && typeof input === 'object' && Object.keys(input).length > 0;
}

export function formatToolInput(input: unknown): string {
  return JSON.stringify(input, null, 2);
}

export default function QuietToolBlock({
  icon = '↳',
  label,
  detail,
  isError,
  result,
  input,
}: {
  icon?: string | null;
  label?: string | null;
  detail?: string | null;
  isError?: boolean;
  result?: unknown;
  input?: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = result == null;
  const showInput = hasToolInput(input);
  // Completed typed rows pass an empty result when there is nothing to show.
  const showResult =
    result != null && (typeof result !== 'string' || result.trim() !== '' || isError);
  const showExpandedBody = expanded && (showInput || showResult);

  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      className="text-xs font-mono py-0.5 pl-1 cursor-pointer overflow-hidden"
    >
      <div className="flex items-center gap-1.5 text-faint">
        <span>{icon ?? '↳'}</span>
        <span className={isError ? 'text-red-700' : ''}>{label}</span>
        {detail && <span className="truncate text-faint">{detail}</span>}
        {isError && <span className="text-red-700 ml-0.5">[error]</span>}
        {isRunning && !isError && (
          <div className="w-2.5 h-2.5 border border-strong border-t-faint rounded-full animate-spin shrink-0" />
        )}
      </div>
      {showExpandedBody && (
        <div className="mt-1 pl-3 space-y-2">
          {showInput && (
            <div>
              <div className="text-faint font-medium mb-0.5">Input</div>
              <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-48">
                {formatToolInput(input)}
              </pre>
            </div>
          )}
          {showResult && (
            <div>
              {showInput && <div className="text-faint font-medium mb-0.5">Result</div>}
              <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-48">
                {typeof result === 'string' && !result.trim() && isError
                  ? 'Tool call failed'
                  : typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
