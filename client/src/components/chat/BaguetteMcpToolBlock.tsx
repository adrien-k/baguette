import { ChevronDown } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { sessionsService } from '../../feathers.js';
import { useFilterRoutes } from '../../hooks/useFilterRoutes.js';
import { DIFF_LINE_WRAP_CLASS, DIFF_SCROLL_WRAP_CLASS } from '../../utils/diffLineWrap.js';
import MarkdownContent from '../MarkdownContent.jsx';
import { ansiToHtml } from '../../utils/ansi.js';
import { splitPreviewLines } from '../../utils/chatContentPreview.js';
import QuietToolBlock, { hasToolInput, formatToolInput } from './QuietToolBlock.tsx';
import BashToolBlock from './BashToolBlock.tsx';
import ShowPlanBlock from './ShowPlanBlock.tsx';
import SessionTodoToolBlock from './SessionTodoToolBlock.tsx';

function formatRunTaskCommand(label: string, runArgs?: unknown) {
  const parts = Array.isArray(runArgs)
    ? runArgs.filter((a): a is string => typeof a === 'string')
    : [];
  return parts.length > 0 ? `${label} ${parts.join(' ')}` : label;
}

const ISSUE_SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-danger/15 text-danger border-danger/35',
  high: 'bg-warning/15 text-warning border-warning/35',
  medium: 'bg-brand/15 text-warning border-brand/35',
  low: 'bg-control/80 text-fg-muted border-strong/80',
};

/** Loose shape of parsed MCP JSON results consumed by the blocks below. */
type McpResultData = {
  issue?: { severity?: string; title?: string; id?: string | number };
  ok?: boolean;
  message?: string;
  url?: string;
  [key: string]: unknown;
};

/** Block-local view of a baguette/mcp tool call: plain data, no message-shape coupling. */
export type McpBlockData = {
  result?: unknown;
  isError?: boolean;
  input?: Record<string, unknown>;
};

function parseJsonObject(text: unknown): McpResultData | null {
  if (typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as McpResultData) : null;
  } catch {
    return null;
  }
}

function mcpDataHasPayload(data: Record<string, unknown>): boolean {
  return (
    data.todo != null ||
    data.todos != null ||
    data.markdown != null ||
    data.ok === true ||
    data.ok === false ||
    data.error != null
  );
}

function parseMcpJsonResult(result: unknown): McpResultData | null {
  if (result == null) return null;
  if (typeof result === 'object') {
    const obj = result as McpResultData & { data?: unknown; content?: unknown };
    const fromContent = parseJsonObject(obj.content);

    if (obj.data != null && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
      const data = obj.data as Record<string, unknown>;
      if (mcpDataHasPayload(data)) {
        return fromContent ? { ...fromContent, ...data } : (data as McpResultData);
      }
    }

    if (fromContent) return fromContent;
    return obj;
  }
  if (typeof result !== 'string' || !result.trim()) return null;
  return parseJsonObject(result);
}

function PrUpsertBlock({
  title,
  body,
  result,
  isError,
}: {
  title?: string;
  body?: string;
  result?: unknown;
  isError?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = result == null;
  const { preview: previewBody, remaining } = splitPreviewLines(body ?? '');

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${isError ? 'border-danger/60' : 'border-info/50'}`}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-control/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-accent text-xs font-mono shrink-0">Pull Request</span>
          {isError && (
            <span className="shrink-0 text-danger text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
              error
            </span>
          )}
          <span className="text-fg text-xs font-semibold truncate">{title}</span>
        </div>
        {isRunning ? (
          <div className="w-3.5 h-3.5 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <ChevronDown
            className={`w-4 h-4 text-faint shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {!expanded && body && (
        <div className="px-3 sm:px-4 pb-2 text-xs text-faint">
          <MarkdownContent>{previewBody}</MarkdownContent>
          {remaining > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setExpanded(true);
                }
              }}
              className="text-faint hover:text-fg-muted transition-colors mt-1 font-mono cursor-pointer"
            >
              &hellip; {remaining} more line{remaining !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-line text-xs space-y-3">
          <div className="text-fg-muted">
            <MarkdownContent>{body ?? ''}</MarkdownContent>
          </div>
          {result != null && isError && (
            <div>
              <div className="font-medium mb-1 text-danger">Error</div>
              <pre className="whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 text-danger bg-red-950/30">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateIssueBlock({ block }: { block: McpBlockData }) {
  const { short_id } = useParams();
  const { sessionUrl } = useFilterRoutes();
  const [searchParams] = useSearchParams();
  const mcpResult = parseMcpJsonResult(block.result);
  const issue = mcpResult?.issue;
  const severity = (issue?.severity ?? block.input?.severity) as string | undefined;
  const title = (issue?.title ?? block.input?.title ?? '(no title)') as string;
  const issueRef = issue?.ref;
  const isRunning = block.result == null;
  const isError = Boolean(block.isError || mcpResult?.ok === false);

  const panel = searchParams.get('panel');
  const openTo = useMemo(() => {
    if (!short_id) return null;
    const params = new URLSearchParams();
    params.set('view', 'review');
    if (panel) params.set('panel', panel);
    const hash = issueRef != null ? `#issue-${issueRef}` : '';
    return `${sessionUrl(short_id)}?${params.toString()}${hash}`;
  }, [short_id, sessionUrl, panel, issueRef]);

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${isError ? 'border-danger/60' : 'border-line'}`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 min-w-0">
        <span className="text-accent text-xs font-mono shrink-0">Issue</span>
        {severity ? (
          <span
            className={`inline-flex items-center justify-center h-5 shrink-0 rounded-md border px-1.5 text-[10px] uppercase tracking-wide ${ISSUE_SEVERITY_CLASS[severity] || ISSUE_SEVERITY_CLASS.low}`}
          >
            {severity}
          </span>
        ) : null}
        {isError && (
          <span className="shrink-0 text-danger text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
            error
          </span>
        )}
        <span className="text-fg text-xs font-semibold truncate min-w-0 flex-1">{title}</span>
        {isRunning ? (
          <div className="w-3.5 h-3.5 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : openTo ? (
          <Link to={openTo} className="text-accent text-xs font-medium shrink-0 hover:underline">
            Open
          </Link>
        ) : null}
      </div>
      {isError && block.result != null && (
        <div className="px-3 sm:px-4 pb-2">
          <pre className="whitespace-pre-wrap overflow-auto max-h-40 rounded p-2 text-danger bg-red-950/30 text-xs">
            {typeof block.result === 'string'
              ? block.result
              : JSON.stringify(block.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── ShowDiffBlock (private — only used by BaguetteMcpToolBlock) ──────────────

function ShowDiffBlock({
  path: filePath,
  sessionId,
}: {
  path: string;
  sessionId?: number | string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !filePath) return;
    // Custom service methods are registered at runtime and missing from feathers' types.
    (
      sessionsService as unknown as {
        showDiff(args: {
          id: number | string;
          path: string;
        }): Promise<{ error?: string; diff?: string }>;
      }
    )
      .showDiff({ id: sessionId, path: filePath })
      .then((res: { error?: string; diff?: string }) => {
        if (res.error) setError(res.error);
        setDiff(res.diff ?? '');
      })
      .catch((err: { message?: string }) => {
        setError(err?.message ?? 'Failed to load diff');
        setDiff('');
      });
  }, [sessionId, filePath]);

  if (diff === null && !error) {
    return (
      <div className="rounded-lg border border-strong bg-nav p-3 text-xs text-faint">
        Loading diff for <span className="text-fg-muted font-mono">{filePath}</span>…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-nav p-3 text-xs">
        <span className="text-fg-muted font-mono">{filePath}</span>
        <span className="ml-2 text-danger">{error}</span>
      </div>
    );
  }

  const lines = (diff || '').split('\n');
  type DiffHunk = { header: string; lines: string[] };
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

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
    { type: 'hunk' as const, text: h.header },
    ...h.lines.map((l) => ({ type: 'line' as const, text: l })),
  ]);
  const preview = allLines.slice(0, PREVIEW_LINES);
  const shown = expanded ? allLines : preview;
  const hasMore = allLines.length > PREVIEW_LINES;

  if (!diff || diff === '(no diff)') {
    return (
      <div className="rounded-lg border border-strong bg-nav text-xs font-mono overflow-hidden">
        <div className="px-3 py-2 flex items-center gap-2 border-b border-strong bg-control/50">
          <span className="text-fg-muted">diff</span>
          <span className="text-fg">{filePath}</span>
        </div>
        <div className="px-3 py-2 text-faint italic">No changes</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-strong bg-nav text-xs font-mono overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-strong bg-control/50">
        <span className="text-fg-muted">diff</span>
        <span className="text-fg truncate">{filePath}</span>
      </div>
      <div className={DIFF_SCROLL_WRAP_CLASS}>
        <pre className={`px-3 py-2 leading-5 ${DIFF_LINE_WRAP_CLASS}`}>
          {shown.map((l, i) => {
            if (l.type === 'hunk') {
              return (
                <div key={i} className={`text-cyan-500/80 ${DIFF_LINE_WRAP_CLASS}`}>
                  {l.text}
                </div>
              );
            }
            const ch = l.text[0];
            const cls =
              ch === '+'
                ? 'text-green-400 bg-green-950/30'
                : ch === '-'
                  ? 'text-danger bg-red-950/30'
                  : 'text-fg-muted';
            return (
              <div key={i} className={`${cls} ${DIFF_LINE_WRAP_CLASS}`}>
                {l.text || ' '}
              </div>
            );
          })}
        </pre>
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full px-3 py-1.5 text-xs text-faint hover:text-secondary hover:bg-control/50 border-t border-strong transition-colors text-left"
        >
          {expanded ? '↑ Show less' : `↓ Show all ${allLines.length} lines`}
        </button>
      )}
    </div>
  );
}

// ─── UploadImageBlock ─────────────────────────────────────────────────────────

function UploadImageBlock({
  block,
  mcpResult,
}: {
  block: McpBlockData;
  mcpResult: McpResultData | null;
}) {
  const [open, setOpen] = useState(false);
  const imageUrl = mcpResult?.url as string | undefined;
  const altText = (block.input?.altText as string | undefined) ?? 'uploaded image';

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!imageUrl) {
    return (
      <QuietToolBlock
        icon="🖼"
        label="UploadImage"
        isError={block.isError}
        result={block.result}
        input={block.input}
      />
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block mt-1 rounded border border-strong overflow-hidden hover:border-faint transition-colors cursor-zoom-in"
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
                className="absolute -top-8 right-0 text-fg-muted hover:text-fg text-sm"
              >
                ✕ close
              </button>
              <img
                src={imageUrl}
                alt={altText}
                className="max-w-full max-h-[85vh] rounded border border-strong object-contain"
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

// ─── ReadTaskOutputBlock ─────────────────────────────────────────────────────

function ReadTaskOutputBlock({ block }: { block: McpBlockData }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = block.result == null;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed =
      block.result != null
        ? typeof block.result === 'string'
          ? (JSON.parse(block.result) as Record<string, unknown>)
          : (block.result as Record<string, unknown>)
        : null;
  } catch {
    /* ignore */
  }

  const taskId = block.input?.taskId ?? parsed?.taskId;
  const taskIdLabel = taskId != null ? `#${String(taskId)}` : null;
  const logsHtml = useMemo(() => {
    const rawLog = parsed?.log;
    const rawLines = parsed?.lines;
    const text =
      rawLog != null
        ? String(rawLog)
        : Array.isArray(rawLines)
          ? (rawLines as string[]).join('\n')
          : '';
    return text ? ansiToHtml(text) : '';
  }, [parsed]);

  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      className="text-xs font-mono py-0.5 pl-1 cursor-pointer overflow-hidden"
    >
      <div className="flex items-center gap-1.5 text-faint">
        <span>↳</span>
        <span>ReadTaskOutput</span>
        {taskIdLabel && <span className="truncate text-faint">{taskIdLabel}</span>}
        {isRunning && (
          <div className="w-2.5 h-2.5 border border-strong border-t-faint rounded-full animate-spin shrink-0" />
        )}
      </div>
      {expanded && hasToolInput(block.input) && (
        <div className="mt-1 pl-3">
          <div className="text-faint font-medium mb-0.5">Input</div>
          <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-48">
            {formatToolInput(block.input)}
          </pre>
        </div>
      )}
      {expanded && logsHtml && (
        <div className="mt-1 pl-3">
          {hasToolInput(block.input) && <div className="text-faint font-medium mb-0.5">Result</div>}
          <pre
            className="ansi-log py-2 pr-2 rounded-md whitespace-pre-wrap overflow-auto max-h-48"
            dangerouslySetInnerHTML={{ __html: logsHtml }}
          />
        </div>
      )}
      {expanded && !logsHtml && parsed && (
        <div className="mt-1 pl-3">
          {hasToolInput(block.input) && <div className="text-faint font-medium mb-0.5">Result</div>}
          <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-48">
            {typeof block.result === 'string' ? block.result : JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── BaguetteMcpToolBlock ─────────────────────────────────────────────────────
// Tool-name dispatch for Baguette MCP tool calls. Shared by the typed renderer
// (`chat/ToolCallBlock`) and live-stream `chat/ToolUseBlock` (claude/cursor):
// callers pass plain data (`tool`, `args`, `result`, `isError`) rather than a
// specific message shape.

export default function BaguetteMcpToolBlock({
  tool: toolShortName,
  args = {},
  result,
  isError = false,
  startedAt,
  sessionId,
  session,
  userReplied = false,
}: {
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  startedAt?: string | null;
  sessionId?: number | string | null;
  session?: { agent_sdk?: string | null; model?: string | null; model_params?: unknown } | null;
  userReplied?: boolean;
}) {
  const mcpResult = parseMcpJsonResult(result);

  if (
    toolShortName === 'CreateTodo' ||
    toolShortName === 'ProcessTodo' ||
    toolShortName === 'CompleteTodo'
  ) {
    return (
      <SessionTodoToolBlock
        toolName={toolShortName}
        args={args}
        mcpResult={mcpResult}
        result={result}
        isError={isError}
      />
    );
  }

  if (
    toolShortName === 'CreatePlan' ||
    toolShortName === 'EditPlan' ||
    toolShortName === 'ReadPlan'
  ) {
    const markdownFromResult = (mcpResult?.markdown as string | undefined) ?? '';
    const markdownFromArgs =
      typeof args.markdown === 'string' && args.markdown.trim() ? args.markdown : '';
    const markdown = markdownFromResult || (toolShortName === 'CreatePlan' ? markdownFromArgs : '');
    const heading =
      toolShortName === 'CreatePlan'
        ? 'Plan created'
        : toolShortName === 'EditPlan'
          ? 'Plan updated'
          : 'Plan';
    const planFailed = mcpResult?.ok === false;
    const planErrorMessage =
      planFailed && typeof mcpResult?.error === 'string' ? mcpResult.error : null;
    return (
      <ShowPlanBlock
        heading={heading}
        markdown={markdown}
        isRunning={result == null}
        isError={isError || planFailed}
        errorMessage={planErrorMessage}
        sessionId={sessionId != null ? Number(sessionId) : null}
        session={session}
        userReplied={userReplied}
      />
    );
  }

  if (toolShortName === 'CreateIssue') {
    return <CreateIssueBlock block={{ result, isError, input: args }} />;
  }

  if (toolShortName === 'ShowDiff') {
    return (
      <div>
        <QuietToolBlock
          icon="⚙"
          label="ShowDiff"
          detail={args.path as string | undefined}
          isError={isError}
          input={args}
        />
        <ShowDiffBlock path={(args.path as string | undefined) ?? ''} sessionId={sessionId} />
      </div>
    );
  }

  if (toolShortName === 'PrUpsert') {
    return (
      <PrUpsertBlock
        title={(args.title as string | undefined) ?? '(no title)'}
        body={(args.description as string | undefined) ?? ''}
        result={result}
        isError={isError}
      />
    );
  }

  if (toolShortName === 'RunTask') {
    const label = (args.label as string | undefined) ?? 'RunTask';
    const runArgs = (args.args as unknown[]) ?? [];
    return (
      <BashToolBlock
        badgeLabel="RunTask"
        command={formatRunTaskCommand(label, runArgs)}
        result={result}
        isError={isError}
        startedAt={startedAt}
      />
    );
  }

  if (toolShortName === 'AwaitDetachedTask') {
    const taskId = args.taskId;
    const label = taskId != null ? `Await task #${taskId}` : 'AwaitDetachedTask';
    return (
      <BashToolBlock
        badgeLabel="AwaitDetachedTask"
        command={label}
        result={result}
        isError={isError}
        startedAt={startedAt}
      />
    );
  }

  if (toolShortName === 'PrComment') {
    const body = (args.body as string | undefined) ?? '';
    const path = args.path;
    const line = args.line;
    const preview = body.length > 60 ? body.slice(0, 57) + '…' : body;
    const detail = path && line ? `${path}:${line} — ${preview}` : preview;
    return (
      <QuietToolBlock
        icon="⚙"
        label={path && line ? 'PrComment (inline)' : 'PrComment'}
        detail={detail}
        isError={isError}
        result={result}
        input={args}
      />
    );
  }

  if (toolShortName === 'PrReview') {
    const commentCount = (args.comments as unknown[] | undefined)?.length ?? 0;
    const detail = [
      (args.body as string | undefined)?.slice(0, 60),
      commentCount > 0 ? `${commentCount} inline comment${commentCount > 1 ? 's' : ''}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <QuietToolBlock
        icon="⚙"
        label={`PrReview:${args.event ?? ''}`}
        detail={detail}
        isError={isError}
        result={result}
        input={args}
      />
    );
  }

  if (toolShortName === 'ReadTaskOutput') {
    return <ReadTaskOutputBlock block={{ result, input: args }} />;
  }

  if (toolShortName === 'UploadImage') {
    return <UploadImageBlock block={{ result, isError, input: args }} mcpResult={mcpResult} />;
  }

  // Default quiet block: GitPush, GitPull, GitFetch, PrRead, PrComments, etc.
  const detail =
    toolShortName === 'GitFetch'
      ? (args.branch as string | undefined)
      : toolShortName === 'PrWorkflowLogs'
        ? `run ${args.runId ?? ''}`
        : (mcpResult?.message as string | undefined);
  return (
    <QuietToolBlock
      icon="⚙"
      label={toolShortName}
      detail={detail}
      isError={isError}
      result={result}
      input={args}
    />
  );
}
