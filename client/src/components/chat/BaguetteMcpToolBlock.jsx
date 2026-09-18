import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { sessionsService } from '../../feathers.js';
import MarkdownContent from '../MarkdownContent.jsx';
import { ansiToHtml } from '../../utils/ansi.js';

// ─── Shared primitives (also used by ToolUseBlock for legacy baguette-op rendering) ───

export function QuietToolBlock({ icon, label, detail, isError, result }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = result == null;
  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      className="text-xs font-mono py-0.5 pl-1 cursor-pointer overflow-hidden"
    >
      <div className="flex items-center gap-1.5 text-zinc-700">
        <span>{icon ?? '↳'}</span>
        <span className={isError ? 'text-red-700' : ''}>{label}</span>
        {detail && <span className="truncate text-zinc-800">{detail}</span>}
        {isError && <span className="text-red-700 ml-0.5">[error]</span>}
        {isRunning && !isError && (
          <div className="w-2.5 h-2.5 border border-zinc-700 border-t-zinc-500 rounded-full animate-spin shrink-0" />
        )}
      </div>
      {expanded && result != null && (
        <pre className="mt-1 pl-3 text-zinc-700 whitespace-pre-wrap overflow-auto max-h-48">
          {result}
        </pre>
      )}
    </div>
  );
}

export function CommandBlock({ baguetteOp, block }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = block.result == null;
  let parsed = null;
  if (typeof block.result === 'string') {
    try {
      parsed = JSON.parse(block.result);
    } catch {
      parsed = null;
    }
  } else if (block.result && typeof block.result === 'object') {
    parsed = block.result;
  }

  const exitCode = parsed?.exitCode;
  const stdout = Array.isArray(parsed?.stdoutLines)
    ? parsed.stdoutLines.join('\n')
    : (parsed?.stdout ?? '');
  const stderr = Array.isArray(parsed?.stderrLines)
    ? parsed.stderrLines.join('\n')
    : (parsed?.stderr ?? '');
  const ok = parsed?.ok;
  const stdoutHtml = useMemo(() => (stdout ? ansiToHtml(stdout) : ''), [stdout]);
  const stderrHtml = useMemo(() => (stderr ? ansiToHtml(stderr) : ''), [stderr]);

  const hasError =
    block.isError || ok === false || (typeof exitCode === 'number' && exitCode !== 0);

  return (
    <div
      className={`bg-zinc-900/50 rounded-lg border overflow-hidden ${hasError ? 'border-red-800/60' : 'border-zinc-800'}`}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-zinc-800/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 text-xs font-mono shrink-0">command</span>
          {hasError && (
            <span className="shrink-0 text-red-400 text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
              {typeof exitCode === 'number' ? `exit ${exitCode}` : 'error'}
            </span>
          )}
          <span className="text-xs text-zinc-300 truncate">
            {baguetteOp.arg?.label || '(no label)'}
          </span>
          {Array.isArray(baguetteOp.arg?.args) && baguetteOp.arg.args.length > 0 && (
            <code className="text-[10px] text-zinc-500 truncate">
              {baguetteOp.arg.args.join(' ')}
            </code>
          )}
        </div>
        {isRunning ? (
          <div className="w-3.5 h-3.5 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <svg
            className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-zinc-800 text-xs space-y-3">
          {stdout && (
            <div>
              <div className="text-zinc-500 font-medium mb-1">stdout</div>
              <pre
                className="whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 text-zinc-300 bg-zinc-950/50"
                dangerouslySetInnerHTML={{ __html: stdoutHtml }}
              />
            </div>
          )}
          {stderr && (
            <div>
              <div className="text-zinc-500 font-medium mb-1">stderr</div>
              <pre
                className="whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 text-red-300 bg-red-950/30"
                dangerouslySetInnerHTML={{ __html: stderrHtml }}
              />
            </div>
          )}
          {!stdout && !stderr && block.result != null && (
            <div>
              <div className="text-zinc-500 font-medium mb-1">Result</div>
              <pre className="whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 text-zinc-400 bg-zinc-950/50">
                {typeof block.result === 'string'
                  ? block.result
                  : JSON.stringify(block.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PrUpsertBlock({ title, body, result, isError }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = result == null;
  const PREVIEW_LINES = 4;
  const bodyLines = (body ?? '').split('\n');
  const previewBody = bodyLines.slice(0, PREVIEW_LINES).join('\n');
  const remaining = bodyLines.length - PREVIEW_LINES;

  return (
    <div
      className={`bg-zinc-900/50 rounded-lg border overflow-hidden ${isError ? 'border-red-800/60' : 'border-indigo-900/50'}`}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-zinc-800/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 text-xs font-mono shrink-0">Pull Request</span>
          {isError && (
            <span className="shrink-0 text-red-400 text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
              error
            </span>
          )}
          <span className="text-white text-xs font-semibold truncate">{title}</span>
        </div>
        {isRunning ? (
          <div className="w-3.5 h-3.5 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <svg
            className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {!expanded && body && (
        <div className="px-3 sm:px-4 pb-2 text-xs text-zinc-500">
          <MarkdownContent>{previewBody}</MarkdownContent>
          {remaining > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors mt-1 font-mono"
            >
              &hellip; {remaining} more line{remaining !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-zinc-800 text-xs space-y-3">
          <div className="text-zinc-400">
            <MarkdownContent>{body ?? ''}</MarkdownContent>
          </div>
          {result != null && (
            <div>
              <div className={`font-medium mb-1 ${isError ? 'text-red-400' : 'text-zinc-500'}`}>
                {isError ? 'Error' : 'Result'}
              </div>
              <pre
                className={`whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 ${isError ? 'text-red-300 bg-red-950/30' : 'text-zinc-400 bg-zinc-950/50'}`}
              >
                {result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ShowDiffBlock (private — only used by BaguetteMcpToolBlock) ──────────────

function ShowDiffBlock({ path: filePath, sessionId }) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId || !filePath) return;
    sessionsService
      .showDiff({ id: sessionId, path: filePath })
      .then((res) => {
        if (res.error) setError(res.error);
        setDiff(res.diff ?? '');
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load diff');
        setDiff('');
      });
  }, [sessionId, filePath]);

  if (diff === null && !error) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-500">
        Loading diff for <span className="text-zinc-400 font-mono">{filePath}</span>…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-zinc-900 p-3 text-xs">
        <span className="text-zinc-400 font-mono">{filePath}</span>
        <span className="ml-2 text-red-400">{error}</span>
      </div>
    );
  }

  const lines = (diff || '').split('\n');
  const hunks = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);

  const PREVIEW_LINES = 12;
  const allLines = hunks.flatMap((h) => [
    { type: 'hunk', text: h.header },
    ...h.lines.map((l) => ({ type: 'line', text: l })),
  ]);
  const preview = allLines.slice(0, PREVIEW_LINES);
  const shown = expanded ? allLines : preview;
  const hasMore = allLines.length > PREVIEW_LINES;

  if (!diff || diff === '(no diff)') {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 text-xs font-mono overflow-hidden">
        <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-700 bg-zinc-800/50">
          <span className="text-zinc-400">diff</span>
          <span className="text-white">{filePath}</span>
        </div>
        <div className="px-3 py-2 text-zinc-500 italic">No changes</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 text-xs font-mono overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-700 bg-zinc-800/50">
        <span className="text-zinc-400">diff</span>
        <span className="text-white truncate">{filePath}</span>
      </div>
      <div className="overflow-x-auto">
        <pre className="px-3 py-2 leading-5">
          {shown.map((l, i) => {
            if (l.type === 'hunk') {
              return (
                <div key={i} className="text-cyan-500/80">
                  {l.text}
                </div>
              );
            }
            const ch = l.text[0];
            const cls =
              ch === '+'
                ? 'text-green-400 bg-green-950/30'
                : ch === '-'
                  ? 'text-red-400 bg-red-950/30'
                  : 'text-zinc-400';
            return (
              <div key={i} className={`${cls} min-w-0`}>
                {l.text || ' '}
              </div>
            );
          })}
        </pre>
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border-t border-zinc-700 transition-colors text-left"
        >
          {expanded ? '↑ Show less' : `↓ Show all ${allLines.length} lines`}
        </button>
      )}
    </div>
  );
}

// ─── UploadImageBlock ─────────────────────────────────────────────────────────

function UploadImageBlock({ block, mcpResult }) {
  const [open, setOpen] = useState(false);
  const imageUrl = mcpResult?.url;
  const altText = block.input?.altText ?? 'uploaded image';

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!imageUrl) {
    return (
      <QuietToolBlock icon="🖼" label="UploadImage" isError={block.isError} result={block.result} />
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block mt-1 rounded border border-zinc-700 overflow-hidden hover:border-zinc-500 transition-colors cursor-zoom-in"
      >
        <img src={imageUrl} alt={altText} className="max-w-xs max-h-48 object-contain" />
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={close}
          >
            <div
              className="relative max-w-[90vw] max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={close}
                className="absolute -top-8 right-0 text-zinc-400 hover:text-white text-sm"
              >
                ✕ close
              </button>
              <img
                src={imageUrl}
                alt={altText}
                className="max-w-full max-h-[85vh] rounded border border-zinc-700 object-contain"
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

// ─── ReadTaskOutputBlock ─────────────────────────────────────────────────────

function ReadTaskOutputBlock({ block }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = block.result == null;

  let parsed = null;
  try {
    parsed =
      block.result != null
        ? typeof block.result === 'string'
          ? JSON.parse(block.result)
          : block.result
        : null;
  } catch {
    /* ignore */
  }

  const taskId = block.input?.taskId ?? parsed?.taskId;
  const logsHtml = useMemo(() => {
    const lines = parsed?.lines ?? [];
    const text = lines.join('\n');
    return text ? ansiToHtml(text) : '';
  }, [parsed]);

  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      className="text-xs font-mono py-0.5 pl-1 cursor-pointer overflow-hidden"
    >
      <div className="flex items-center gap-1.5 text-zinc-700">
        <span>↳</span>
        <span>ReadTaskOutput</span>
        {taskId != null && <span className="truncate text-zinc-800">#{taskId}</span>}
        {isRunning && (
          <div className="w-2.5 h-2.5 border border-zinc-700 border-t-zinc-500 rounded-full animate-spin shrink-0" />
        )}
      </div>
      {expanded && logsHtml && (
        <pre
          className="mt-1 pl-3 whitespace-pre-wrap overflow-auto max-h-48"
          dangerouslySetInnerHTML={{ __html: logsHtml }}
        />
      )}
      {expanded && !logsHtml && parsed && (
        <pre className="mt-1 pl-3 text-zinc-700 whitespace-pre-wrap overflow-auto max-h-48">
          {typeof block.result === 'string' ? block.result : JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── BaguetteMcpToolBlock ─────────────────────────────────────────────────────

export default function BaguetteMcpToolBlock({ block, sessionId }) {
  const toolShortName = block.name.replace('mcp__baguette__', '');
  let mcpResult = null;
  try {
    mcpResult = JSON.parse(block.result);
  } catch {
    /* ignore */
  }

  if (toolShortName === 'ShowDiff') {
    return (
      <div>
        <QuietToolBlock
          icon="⚙"
          label="ShowDiff"
          detail={block.input?.path}
          isError={block.isError}
        />
        <ShowDiffBlock path={block.input?.path ?? ''} sessionId={sessionId} />
      </div>
    );
  }

  if (toolShortName === 'PrUpsert') {
    return (
      <PrUpsertBlock
        title={block.input?.title ?? '(no title)'}
        body={block.input?.description ?? ''}
        result={block.result}
        isError={block.isError}
      />
    );
  }

  if (toolShortName === 'RunProjectCommand') {
    return (
      <CommandBlock
        baguetteOp={{ arg: { label: block.input?.label ?? '', args: block.input?.args ?? [] } }}
        block={block}
      />
    );
  }

  if (toolShortName === 'PrComment') {
    const body = block.input?.body ?? '';
    const path = block.input?.path;
    const line = block.input?.line;
    const preview = body.length > 60 ? body.slice(0, 57) + '…' : body;
    const detail = path && line ? `${path}:${line} — ${preview}` : preview;
    return (
      <QuietToolBlock
        icon="⚙"
        label={path && line ? 'PrComment (inline)' : 'PrComment'}
        detail={detail}
        isError={block.isError}
        result={block.result}
      />
    );
  }

  if (toolShortName === 'PrReview') {
    const commentCount = block.input?.comments?.length ?? 0;
    const detail = [
      block.input?.body?.slice(0, 60),
      commentCount > 0 ? `${commentCount} inline comment${commentCount > 1 ? 's' : ''}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <QuietToolBlock
        icon="⚙"
        label={`PrReview:${block.input?.event ?? ''}`}
        detail={detail}
        isError={block.isError}
        result={block.result}
      />
    );
  }

  if (toolShortName === 'ReadTaskOutput') {
    return <ReadTaskOutputBlock block={block} />;
  }

  if (toolShortName === 'UploadImage') {
    return <UploadImageBlock block={block} mcpResult={mcpResult} />;
  }

  // Default quiet block: GitPush, GitPull, GitFetch, PrRead, PrComments, etc.
  const detail =
    toolShortName === 'GitFetch'
      ? block.input?.branch
      : toolShortName === 'PrWorkflowLogs'
        ? `run ${block.input?.runId ?? ''}`
        : (mcpResult?.message ?? undefined);
  return (
    <QuietToolBlock
      icon="⚙"
      label={toolShortName}
      detail={detail}
      isError={block.isError}
      result={block.result}
    />
  );
}
