import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { resolveBashCommand } from '@baguette/shared/resolve-bash-command.js';
import { parseShellToolResult } from '../../utils/shellToolResult.js';
import { stripCdWorktreePrefix } from '../../utils/paths.js';
import ToolRunElapsed from './ToolRunElapsed.tsx';
import TerminalLogBlock from './TerminalLogBlock.tsx';

/**
 * Bash command block with expandable stdout/stderr terminal logs.
 * Props are plain data (`result`/`isError`) so both typed tool_call rows and
 * legacy tool_use blocks can drive it.
 */
export default function BashToolBlock({
  command,
  args,
  worktreePath,
  result,
  isError,
  startedAt,
}: {
  command?: string | null;
  args?: Record<string, unknown> | null;
  worktreePath?: string | null;
  result?: unknown;
  isError?: boolean;
  startedAt?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const resolvedCommand = command?.trim() ? command : resolveBashCommand(args ?? undefined);
  const isRunning = result == null;
  const { exitCode, stdout, stderr } = useMemo(() => {
    const shell = result as
      | { exit_code?: number | null; stdout?: string | null; stderr?: string | null }
      | string
      | null
      | undefined;
    if (shell && typeof shell === 'object' && 'exit_code' in shell) {
      return {
        exitCode: shell.exit_code ?? null,
        stdout: shell.stdout ?? '',
        stderr: shell.stderr ?? '',
      };
    }
    return parseShellToolResult(result);
  }, [result]);
  const hasError = isError || (exitCode != null && !Number.isNaN(exitCode) && exitCode !== 0);
  const headerPreview =
    stripCdWorktreePrefix(resolvedCommand, worktreePath)
      ?.split('\n')
      .find((l: string) => l.trim()) ?? '';

  const commandAndStdout = useMemo(() => {
    const parts: string[] = [];
    if (resolvedCommand) parts.push(resolvedCommand);
    if (stdout) parts.push(stdout);
    if (parts.length === 0 && result != null && !stderr) {
      parts.push(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
    return parts.join('\n');
  }, [resolvedCommand, stdout, stderr, result]);

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${hasError ? 'border-danger/60' : 'border-line'}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-control/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-accent text-xs font-mono shrink-0">Bash</span>
          {hasError && (
            <span className="shrink-0 text-danger text-xs font-medium bg-soft-danger/40 px-1.5 py-0.5 rounded">
              {exitCode != null && !Number.isNaN(exitCode) ? `exit ${exitCode}` : 'error'}
            </span>
          )}
          {headerPreview && <code className="text-fg-muted text-xs truncate">{headerPreview}</code>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunning && startedAt ? <ToolRunElapsed startedAt={startedAt} /> : null}
          {isRunning ? (
            <div className="w-3.5 h-3.5 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
          ) : (
            <ChevronDown
              className={`w-4 h-4 text-faint shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-line text-xs space-y-3">
          <TerminalLogBlock text={commandAndStdout} />
          <TerminalLogBlock label="stderr" text={stderr} />
          {!isRunning && (
            <div className="flex items-baseline gap-2">
              <span className="text-faint font-medium">Exit code</span>
              <span
                className={
                  exitCode != null && !Number.isNaN(exitCode) && exitCode !== 0
                    ? 'text-danger font-mono'
                    : 'text-success font-mono'
                }
              >
                {exitCode != null && !Number.isNaN(exitCode) ? exitCode : '—'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
