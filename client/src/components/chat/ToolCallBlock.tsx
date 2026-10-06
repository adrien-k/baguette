import { useState, useMemo } from 'react';
import { Bot, ChevronDown, CheckSquare2, Loader2, Square } from 'lucide-react';
import type {
  BashToolResult,
  EditToolResult,
  GenericToolResult,
  McpToolResult,
  TaskToolResult,
  ToolCallPayload,
} from '@baguette/shared/session-messages.ts';
import { planMarkdownFromToolInput } from '@baguette/shared/session-message-mappers.js';
import { stripWorktreePath } from '../../utils/paths.js';
import EditDiffView from './EditDiffView.tsx';
import QuietToolBlock from './QuietToolBlock.tsx';
import BashToolBlock from './BashToolBlock.tsx';
import AskUserQuestionBlock, { type AskUserQuestion } from './AskUserQuestionBlock.tsx';
import PlanReviewBlock from './PlanReviewBlock.tsx';
import BaguetteMcpToolBlock from './BaguetteMcpToolBlock.tsx';

/**
 * Renderer for typed `tool_call` rows (payload fields + row meta). Reads the
 * normalized `kind`/`args`/`result` shapes produced by the shared mappers — no
 * SDK/legacy block shapes.
 */

type TypedToolCall = ToolCallPayload & {
  id: number;
  tool_started_at?: string | null;
  call_id?: string | null;
};

function TodoBlock({ todos }: { todos?: unknown }) {
  const list = Array.isArray(todos) ? todos : [];
  return (
    <div className="py-0.5 pl-1 space-y-0.5">
      {list.map((todo, i) => {
        const t = todo as { status?: string; content?: string };
        const isCompleted = t.status === 'completed';
        const isInProgress = t.status === 'in_progress';
        return (
          <div
            key={i}
            className={`flex items-center gap-1.5 text-xs ${isCompleted ? 'text-faint' : isInProgress ? 'text-secondary' : 'text-faint'}`}
          >
            {isCompleted ? (
              <CheckSquare2 className="w-3 h-3 shrink-0 text-success" />
            ) : isInProgress ? (
              <Loader2 className="w-3 h-3 shrink-0 text-accent animate-spin" />
            ) : (
              <Square className="w-3 h-3 shrink-0 text-faint" />
            )}
            <span className={isCompleted ? 'line-through' : ''}>{t.content}</span>
          </div>
        );
      })}
    </div>
  );
}

function TaskToolBlock({ message }: { message: TypedToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const result = message.result as TaskToolResult | null;
  const isRunning = result == null;
  const description = (message.args.description as string | undefined) || 'Task';
  const subagentType = message.args.subagent_type ? String(message.args.subagent_type) : null;
  const summary = result?.summary;

  return (
    <div className="bg-inset/50 rounded-lg border border-line overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 sm:px-4 py-2 text-left text-xs text-fg-muted hover:bg-control/50 transition-colors"
      >
        <Bot className="w-3.5 h-3.5 shrink-0 text-faint" />
        <span className="truncate flex-1">
          {description}
          {subagentType ? ` (${subagentType})` : ''}
        </span>
        {isRunning ? (
          <div className="w-3 h-3 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <ChevronDown
            className={`w-4 h-4 text-faint shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {expanded && summary != null && (
        <div className="border-t border-line/60 px-3 sm:px-4 py-2 text-xs">
          <div className="text-faint font-medium mb-1">Result</div>
          <pre className="whitespace-pre-wrap overflow-auto max-h-48 text-fg-muted bg-page/50 rounded p-2">
            {summary}
          </pre>
        </div>
      )}
    </div>
  );
}

function EditWriteToolBlock({
  message,
  worktreePath,
}: {
  message: TypedToolCall;
  worktreePath?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isWrite = message.kind === 'write';
  const result = message.result as EditToolResult | null;
  const isRunning = result == null;
  const isError = message.status === 'error';
  const filePath = message.args.path
    ? stripWorktreePath(String(message.args.path), worktreePath)
    : null;

  const oldString = isWrite ? '' : ((message.args.old_string as string | null) ?? null);
  const newString = isWrite
    ? ((message.args.content as string | null) ?? null)
    : ((message.args.new_string as string | null) ?? null);
  // Cursor-native edits persist their diff string on the result.
  const cursorDiff = useMemo(() => {
    const diff = result?.diff;
    return diff ? { diffString: diff } : null;
  }, [result?.diff]);

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${isError ? 'border-danger/60' : 'border-line'}`}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-control/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-accent text-xs font-mono shrink-0">{message.name}</span>
          {isError && (
            <span className="shrink-0 text-danger text-xs font-medium bg-soft-danger/40 px-1.5 py-0.5 rounded">
              error
            </span>
          )}
          {filePath && <code className="text-faint text-xs truncate">{filePath}</code>}
        </div>
        {isRunning ? (
          <div className="w-3.5 h-3.5 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <ChevronDown
            className={`w-4 h-4 text-faint shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {!expanded && (result?.diff || oldString != null || newString != null) && (
        <EditDiffView
          oldString={oldString}
          newString={newString}
          cursorDiff={cursorDiff}
          collapsed
          onExpand={() => setExpanded(true)}
          label={isWrite ? 'Content' : 'Changes'}
        />
      )}

      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-line text-xs space-y-3">
          {result?.diff || oldString != null || newString != null ? (
            <EditDiffView
              oldString={oldString}
              newString={newString}
              cursorDiff={cursorDiff}
              onExpand={() => setExpanded(true)}
              label={isWrite ? 'Content' : 'Changes'}
            />
          ) : (
            <div>
              <div className="text-faint font-medium mb-1">Input</div>
              <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-64 bg-page/50 rounded p-2">
                {JSON.stringify(message.args, null, 2)}
              </pre>
            </div>
          )}
          {result != null && !result.diff && result.error_message && isError && (
            <div>
              <div className="font-medium mb-1 text-danger">Error</div>
              <pre className="whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 text-danger bg-soft-danger/30">
                {result.error_message}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ToolCallBlock({
  message,
  worktreePath,
  sessionId,
  userReplied = false,
}: {
  message: TypedToolCall & { _hidden?: boolean };
  worktreePath?: string | null;
  sessionId?: number;
  userReplied?: boolean;
}) {
  if (message._hidden) return null;
  const isError = message.status === 'error';
  const startedAt = message.tool_started_at ?? message.started_at;
  const args = message.args ?? {};

  switch (message.kind) {
    case 'bash': {
      const result = message.result as BashToolResult | null;
      return (
        <BashToolBlock
          command={String(args.command ?? '')}
          worktreePath={worktreePath}
          result={result}
          isError={isError}
          startedAt={startedAt}
        />
      );
    }
    case 'edit':
    case 'write':
      return <EditWriteToolBlock message={message} worktreePath={worktreePath} />;
    case 'todo':
      return <TodoBlock todos={args.todos} />;
    case 'task':
      return <TaskToolBlock message={message} />;
    case 'ask_user':
      return (
        <AskUserQuestionBlock
          questions={(args.questions ?? []) as AskUserQuestion[]}
          sessionId={sessionId}
          userReplied={userReplied}
        />
      );
    case 'exit_plan':
      return (
        <PlanReviewBlock
          markdown={planMarkdownFromToolInput(args)}
          sessionId={sessionId}
          userReplied={userReplied}
        />
      );
    case 'mcp': {
      // Typed mcp args are flat: { tool: shortName, ...toolFields }.
      const { tool, ...fields } = args as { tool?: string } & Record<string, unknown>;
      const toolName = tool ?? message.name.replace(/^mcp__baguette__/, '') ?? 'mcp';
      return (
        <BaguetteMcpToolBlock
          tool={toolName}
          args={fields}
          result={(message.result as McpToolResult | null)?.data ?? message.result}
          isError={isError}
          startedAt={startedAt}
          sessionId={sessionId}
        />
      );
    }
    default: {
      // read / delete / glob / grep / generic — quiet one-line rows
      const quietResult = message.result as GenericToolResult | null;
      const resultForDisplay = isError
        ? (quietResult?.error_message ?? '')
        : quietResult != null
          ? ''
          : undefined;
      let detail: string | undefined;
      if (message.kind === 'glob') {
        detail = (args.pattern as string) ?? (args.path as string) ?? undefined;
      } else if (message.kind === 'grep') {
        detail =
          [args.pattern, args.path ? stripWorktreePath(String(args.path), worktreePath) : null]
            .filter(Boolean)
            .join(' ') || undefined;
      } else if (args.path) {
        detail = stripWorktreePath(String(args.path), worktreePath);
      } else if (args.label) {
        detail = String(args.label);
      }
      const label =
        message.kind === 'generic'
          ? message.name
          : message.kind.charAt(0).toUpperCase() + message.kind.slice(1);
      return (
        <QuietToolBlock
          label={label}
          detail={detail}
          isError={isError}
          result={resultForDisplay}
          input={args}
        />
      );
    }
  }
}
