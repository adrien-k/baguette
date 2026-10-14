import { useEffect, useState } from 'react';
import { Bot, ChevronDown, Loader2, Wrench, MessageSquare } from 'lucide-react';
import type { TaskConversationStep } from '@baguette/shared/cursor-task-conversation.ts';
import type {
  GenericToolResult,
  ToolCallKind,
  ToolCallPayload,
  ToolResultByKind,
} from '@baguette/shared/session-messages.ts';
import { isBashToolName, resolveBashCommand } from '@baguette/shared/resolve-bash-command.js';
import { stripWorktreePath } from '../../utils/paths.js';
import EditDiffView from './EditDiffView.tsx';
import QuietToolBlock from './QuietToolBlock.tsx';
import BashToolBlock from './BashToolBlock.tsx';
import AskUserQuestionBlock, { type AskUserQuestion } from './AskUserQuestionBlock.tsx';
import PlanReviewBlock from './PlanReviewBlock.tsx';
import BaguetteMcpToolBlock from './BaguetteMcpToolBlock.tsx';
import TodoBlock from './TodoBlock.tsx';

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

/** The `tool_call` variant narrowed to a single kind. */
type CallOfKind<K extends ToolCallKind> = Extract<TypedToolCall, { kind: K }>;

/** Every `tool_call` except the ones with a bespoke block. */
type QuietCall = Exclude<
  TypedToolCall,
  { kind: 'bash' | 'edit' | 'write' | 'todo' | 'task' | 'ask_user' | 'exit_plan' | 'mcp' }
>;

function TaskStepIcon({ step }: { step: TaskConversationStep }) {
  if (step.kind === 'tool') {
    return step.status === 'running' ? (
      <Loader2 className="w-3 h-3 shrink-0 text-accent animate-spin" />
    ) : (
      <Wrench className="w-3 h-3 shrink-0 text-faint" />
    );
  }
  if (step.kind === 'assistant') {
    return <MessageSquare className="w-3 h-3 shrink-0 text-faint" />;
  }
  return <Bot className="w-3 h-3 shrink-0 text-faint" />;
}

function TaskConversationStepsList({ steps }: { steps: TaskConversationStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="space-y-1 max-h-56 overflow-y-auto">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-fg-muted">
          <TaskStepIcon step={step} />
          <span className="min-w-0 break-words">{step.label}</span>
        </li>
      ))}
    </ul>
  );
}

function TaskToolBlock({ message }: { message: CallOfKind<'task'> }) {
  const [expanded, setExpanded] = useState(false);
  const result = message.result;
  const isRunning = message.status === 'running';
  const description = message.args.description || 'Task';
  const subagentType = message.args.subagent_type;
  const summary = result?.summary;
  const steps = result?.steps ?? [];
  const stepCount = result?.step_count ?? steps.length;
  const toolCount = steps.filter((s) => s.kind === 'tool').length;
  const hasTimeline = steps.length > 0;

  useEffect(() => {
    if (isRunning && hasTimeline) setExpanded(true);
  }, [isRunning, hasTimeline, stepCount]);

  const progressLabel =
    stepCount > 0
      ? toolCount > 0
        ? `${stepCount} steps · ${toolCount} tools`
        : `${stepCount} steps`
      : null;

  return (
    <div className="bg-inset/50 rounded-lg border border-line overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 sm:px-4 py-2 text-left text-xs text-fg-muted hover:bg-control/50 transition-colors"
      >
        <Bot className="w-3.5 h-3.5 shrink-0 text-faint" />
        <span className="truncate flex-1">
          {description}
          {subagentType ? ` (${subagentType})` : ''}
        </span>
        {progressLabel ? (
          <span className="text-faint shrink-0 tabular-nums">{progressLabel}</span>
        ) : null}
        {isRunning ? (
          <div className="w-3 h-3 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <ChevronDown
            className={`w-4 h-4 text-faint shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {expanded && (hasTimeline || summary != null) && (
        <div className="border-t border-line/60 px-3 sm:px-4 py-2 text-xs space-y-2">
          {hasTimeline ? (
            <div>
              <div className="text-faint font-medium mb-1">Subagent activity</div>
              <TaskConversationStepsList steps={steps} />
            </div>
          ) : null}
          {summary != null && summary.trim() !== '' && (
            <div>
              <div className="text-faint font-medium mb-1">Summary</div>
              <pre className="whitespace-pre-wrap overflow-auto max-h-48 text-fg-muted bg-page/50 rounded p-2">
                {summary}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditWriteToolBlock({
  message,
  sessionPath,
}: {
  message: CallOfKind<'edit'> | CallOfKind<'write'>;
  sessionPath?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isWrite = message.kind === 'write';
  const result = message.result as ToolResultByKind['edit'] | null;
  const isRunning = result == null;
  const isError = message.status === 'error';
  const filePath = message.args.path
    ? stripWorktreePath(String(message.args.path), sessionPath)
    : null;

  const oldString = isWrite ? '' : (message.args.old_string ?? null);
  const newString = isWrite ? message.args.content : (message.args.new_string ?? null);
  // Some agents persist their diff string on the result.
  const storedDiff = result?.diff ?? null;

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

      {!expanded && (storedDiff || oldString != null || newString != null) && (
        <EditDiffView
          oldString={oldString}
          newString={newString}
          diffString={storedDiff}
          collapsed
          onExpand={() => setExpanded(true)}
          label={isWrite ? 'Content' : 'Changes'}
        />
      )}

      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-line text-xs space-y-3">
          {storedDiff || oldString != null || newString != null ? (
            <EditDiffView
              oldString={oldString}
              newString={newString}
              diffString={storedDiff}
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
  sessionPath,
  sessionId,
  session,
  userReplied = false,
}: {
  message: TypedToolCall & { _hidden?: boolean };
  sessionPath?: string | null;
  sessionId?: number;
  session?: { agent_sdk?: string | null; model?: string | null; model_params?: unknown } | null;
  userReplied?: boolean;
}) {
  if (message._hidden) return null;

  return (
    <ToolCallSwitch
      message={message}
      sessionPath={sessionPath}
      sessionId={sessionId}
      session={session}
      userReplied={userReplied}
    />
  );
}

/**
 * Dispatches on `kind`. Each branch narrows `message` to a single union
 * variant, so `args` and `result` are fully typed there — no casts.
 */
function ToolCallSwitch({
  message,
  sessionPath,
  sessionId,
  session,
  userReplied,
}: {
  message: TypedToolCall & { _hidden?: boolean };
  sessionPath?: string | null;
  sessionId?: number;
  session?: { agent_sdk?: string | null; model?: string | null; model_params?: unknown } | null;
  userReplied?: boolean;
}) {
  const isError = message.status === 'error';
  const startedAt = message.tool_started_at ?? message.started_at;

  const bashCommand =
    message.kind === 'bash' || isBashToolName(message.name)
      ? resolveBashCommand(message.args as Record<string, unknown>)
      : '';

  switch (message.kind) {
    case 'bash':
      return (
        <BashToolBlock
          command={bashCommand}
          args={message.args as Record<string, unknown>}
          sessionPath={sessionPath}
          result={message.result}
          isError={isError}
          startedAt={startedAt}
        />
      );
    case 'edit':
    case 'write':
      return <EditWriteToolBlock message={message} sessionPath={sessionPath} />;
    case 'todo':
      return <TodoBlock todos={message.args.todos} />;
    case 'task':
      return <TaskToolBlock message={message} />;
    case 'ask_user':
      return (
        <AskUserQuestionBlock
          questions={message.args.questions as AskUserQuestion[]}
          sessionId={sessionId}
          session={session}
          userReplied={userReplied}
        />
      );
    case 'exit_plan':
      return (
        <PlanReviewBlock
          markdown={message.args.plan}
          sessionId={sessionId}
          userReplied={userReplied}
        />
      );
    case 'mcp': {
      // Typed mcp args are flat: { tool: shortName, ...toolFields }.
      const { tool, ...fields } = message.args;
      const toolName = tool || message.name.replace(/^mcp__baguette__/, '') || 'mcp';
      const mcpResult = message.result;
      const parsedData =
        mcpResult?.data &&
        typeof mcpResult.data === 'object' &&
        Object.keys(mcpResult.data).length > 0
          ? mcpResult.data
          : null;
      return (
        <BaguetteMcpToolBlock
          tool={toolName}
          args={fields}
          result={parsedData ?? mcpResult}
          isError={isError}
          startedAt={startedAt}
          sessionId={sessionId}
          userReplied={userReplied}
        />
      );
    }
    default:
      if (isBashToolName(message.name)) {
        return (
          <BashToolBlock
            command={bashCommand}
            args={message.args as Record<string, unknown>}
            sessionPath={sessionPath}
            result={message.result}
            isError={isError}
            startedAt={startedAt}
          />
        );
      }
      return <QuietCallBlock message={message} sessionPath={sessionPath} isError={isError} />;
  }
}

/** read / delete / glob / grep / generic — quiet one-line rows. */
function QuietCallBlock({
  message,
  sessionPath,
  isError,
}: {
  message: QuietCall;
  sessionPath?: string | null;
  isError: boolean;
}) {
  const quietResult = message.result as GenericToolResult | null;
  const resultForDisplay = isError
    ? (quietResult?.error_message ?? '')
    : quietResult != null
      ? ''
      : undefined;

  let detail: string | undefined;
  if (message.kind === 'glob') {
    detail = message.args.pattern || message.args.path || undefined;
  } else if (message.kind === 'grep') {
    detail =
      [
        message.args.pattern,
        message.args.path ? stripWorktreePath(message.args.path, sessionPath) : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined;
  } else if (message.kind === 'generic') {
    detail = message.args.detail ?? undefined;
  } else {
    detail = message.args.path ? stripWorktreePath(message.args.path, sessionPath) : undefined;
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
      input={message.args as Record<string, unknown>}
    />
  );
}
