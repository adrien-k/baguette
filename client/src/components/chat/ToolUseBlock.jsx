import { useState, useMemo } from 'react';
import { Bot, CheckSquare2, ChevronDown, Loader2, Square } from 'lucide-react';
import MarkdownContent from '../MarkdownContent.jsx';
import { messagesService, sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import ExitPlanModeBlock from './ExitPlanModeBlock.jsx';
import AskUserQuestionBlock from './AskUserQuestionBlock.jsx';
import { stripWorktreePath } from '../../utils/paths.js';
import EditDiffView from './EditDiffView.jsx';
import BaguetteMcpToolBlock, {
  QuietToolBlock,
  PrUpsertBlock,
  CommandBlock,
  BashToolBlock,
} from './BaguetteMcpToolBlock.jsx';
import CursorMcpToolBlock from './CursorMcpToolBlock.jsx';

const QUIET_TOOLS = new Set(['Glob', 'Read', 'Grep']);

// Cursor SDK tool name → Claude tool name alias for shared rendering
const CURSOR_TOOL_ALIAS = {
  shell: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Task',
};

// Cursor-only tools displayed as quiet read-only blocks
const CURSOR_QUIET_TOOLS = new Set(['ls', 'semSearch', 'readLints']);

function parseQuotedArgs(str) {
  const result = [];
  let i = 0;
  while (i < str.length) {
    const q = str[i];
    if (q !== '"' && q !== "'") {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < str.length && (str[end] !== q || str[end - 1] === '\\')) end++;
    result.push(
      str
        .slice(i + 1, end)
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
    );
    i = end + 1;
  }
  return result;
}

function parseBaguetteOp(command) {
  if (!command?.startsWith('baguette-op ')) return null;
  const rest = command.slice('baguette-op '.length).trim();
  const spaceIdx = rest.indexOf(' ');
  const op = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const argStr = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
  let arg = null;
  if (argStr) {
    if (op === 'pr-upsert') {
      const quoted = parseQuotedArgs(argStr);
      arg = {
        title: quoted[0] ?? argStr.trim(),
        body: quoted[1] ?? '',
      };
    } else if (op === 'command') {
      const quoted = parseQuotedArgs(argStr);
      const [label, ...restArgs] = quoted.length > 0 ? quoted : [argStr];
      arg = {
        label: label ?? '',
        args: restArgs,
      };
    } else {
      try {
        arg = JSON.parse(argStr.replace(/^'([\s\S]*)'$/, '$1').replace(/^"([\s\S])*"$/, '$1'));
      } catch {
        arg = { raw: argStr };
      }
    }
  }
  return { op, arg };
}

const QUIET_BAGUETTE_OPS = new Set([
  'git-push',
  'git-pull',
  'pr-read',
  'list-commands',
  'git-fetch',
]);

function TodoBlock({ todos }) {
  return (
    <div className="py-0.5 pl-1 space-y-0.5">
      {(todos || []).map((todo, i) => {
        const isCompleted = todo.status === 'completed';
        const isInProgress = todo.status === 'in_progress';
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
            <span className={isCompleted ? 'line-through' : ''}>{todo.content}</span>
          </div>
        );
      })}
    </div>
  );
}

function AgentTaskBlock({ block }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = block.result != null;
  const description = block.input?.description || 'Task';
  const subagentType = block.input?.subagent_type;
  const activities = block.agentActivities || [];
  const ACTIVITY_PREVIEW = 8;
  const hidden = !expanded && activities.length > ACTIVITY_PREVIEW;
  const displayLines = hidden ? activities.slice(-ACTIVITY_PREVIEW) : activities;

  const hasContent = activities.length > 0 || hasResult;

  if (!hasContent) {
    return (
      <div className="flex items-center gap-2 py-0.5 pl-1 text-xs text-faint">
        <Bot className="w-3.5 h-3.5 shrink-0 text-faint" />
        <span className="truncate">
          {description}
          {subagentType ? ` (${subagentType})` : ''}
        </span>
        <div className="w-3 h-3 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
      </div>
    );
  }

  return (
    <div className="bg-inset/50 rounded-lg border border-line overflow-hidden">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 text-xs text-fg-muted">
        <Bot className="w-3.5 h-3.5 shrink-0 text-faint" />
        <span className="truncate flex-1">
          {description}
          {subagentType ? ` (${subagentType})` : ''}
        </span>
        {!hasResult && (
          <div className="w-3 h-3 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        )}
      </div>
      {activities.length > 0 && (
        <div className="border-t border-line/60 px-3 sm:px-4 py-2 font-mono text-[11px] text-faint space-y-0.5">
          {hidden && (
            <button
              onClick={() => setExpanded(true)}
              className="text-faint hover:text-faint transition-colors mb-1"
            >
              &hellip; {activities.length - ACTIVITY_PREVIEW} earlier
            </button>
          )}
          {displayLines.map((line, i) => (
            <div key={i} className="truncate">
              ↳ {line}
            </div>
          ))}
          {expanded && (
            <button
              onClick={() => setExpanded(false)}
              className="text-faint hover:text-faint transition-colors mt-1"
            >
              collapse
            </button>
          )}
        </div>
      )}
      {hasResult && block.result && (
        <div className="border-t border-line/60 px-3 sm:px-4 py-2 text-xs">
          <div className="text-faint font-medium mb-1">Result</div>
          <pre className="whitespace-pre-wrap overflow-auto max-h-48 text-fg-muted bg-page/50 rounded p-2">
            {block.result}
          </pre>
        </div>
      )}
    </div>
  );
}

function CursorPlanBlock({ block, sessionId }) {
  const [continuePlanning, setContinuePlanning] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const planMarkdown = block.input?.plan ?? block.input?.description ?? block.input?.content ?? '';
  const firstHeading =
    planMarkdown
      .split('\n')
      .find((l) => l.startsWith('# '))
      ?.slice(2) ?? 'Plan';

  const sendMsg = (text) =>
    messagesService.create({
      session_id: sessionId,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
    });

  const handleRun = async () => {
    setLoading(true);
    try {
      await sessionsService.patch(sessionId, { plan_mode: false });
      await sendMsg('Proceed with the plan.');
    } catch (err) {
      toastError('Failed to run plan', err);
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    const text = feedback.trim() || 'Please continue planning and refine the plan further.';
    setLoading(true);
    try {
      await sendMsg(text);
      setContinuePlanning(false);
      setFeedback('');
    } catch (err) {
      toastError('Failed to send feedback', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-inset/50 rounded-lg border border-brand/20 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 sm:px-4 py-2 text-left hover:bg-control/50 transition-colors"
      >
        <span className="text-accent text-xs font-mono shrink-0">Plan</span>
        <span className="text-heading text-xs font-medium truncate flex-1">{firstHeading}</span>
        <ChevronDown
          className={`w-4 h-4 text-faint shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && planMarkdown && (
        <div className="px-3 sm:px-4 py-3 border-t border-brand/15 text-xs text-secondary overflow-auto max-h-[60vh]">
          <MarkdownContent>{planMarkdown}</MarkdownContent>
        </div>
      )}

      {!continuePlanning && (
        <div className="px-3 sm:px-4 py-2.5 border-t border-brand/10 flex gap-2">
          <button onClick={handleRun} disabled={loading} className={SECONDARY_BUTTON_CLASS}>
            Run the plan
          </button>
          <button
            onClick={() => setContinuePlanning(true)}
            disabled={loading}
            className="px-3 py-1.5 bg-control-hover hover:bg-track disabled:opacity-50 text-heading rounded text-xs font-medium transition-colors"
          >
            Continue planning
          </button>
        </div>
      )}

      {continuePlanning && (
        <div className="px-3 sm:px-4 py-3 border-t border-brand/10 space-y-2">
          <textarea
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleContinue();
              if (e.key === 'Escape') {
                setContinuePlanning(false);
                setFeedback('');
              }
            }}
            placeholder="What should be refined? (optional — leave blank to ask for general improvements)"
            className="w-full px-3 py-2 bg-control border border-strong text-fg rounded text-xs resize-none focus:outline-none focus:border-faint placeholder-faint"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={handleContinue}
              disabled={loading}
              className="px-3 py-1.5 bg-track hover:bg-faint disabled:opacity-50 text-fg rounded text-xs font-medium transition-colors"
            >
              Send feedback
            </button>
            <button
              onClick={() => {
                setContinuePlanning(false);
                setFeedback('');
              }}
              className="px-3 py-1.5 bg-control hover:bg-control-hover text-fg-muted rounded text-xs font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ToolUseBlock({ block, worktreePath, sessionId, userReplied }) {
  // Resolve Cursor SDK tool name aliases to their Claude equivalents
  const effectiveName = CURSOR_TOOL_ALIAS[block.name] ?? block.name;
  let resolvedBlock = effectiveName !== block.name ? { ...block, name: effectiveName } : block;

  // Normalize Cursor camelCase file tool inputs → Claude snake_case convention
  if (block.name === 'edit' || block.name === 'write' || block.name === 'read') {
    const inp = resolvedBlock.input ?? {};
    resolvedBlock = {
      ...resolvedBlock,
      input: {
        ...inp,
        file_path: inp.path ?? inp.file_path,
        old_string: inp.oldString ?? inp.old_string ?? null,
        new_string: inp.newString ?? inp.new_string ?? null,
        content: inp.newContent ?? inp.content ?? null,
      },
    };
  }

  const [expanded, setExpanded] = useState(false);
  const hasResult = resolvedBlock.result != null;

  // Parse Cursor's native edit/write result: {status, value: {diffString, linesAdded, linesRemoved}}
  const cursorNativeDiff = useMemo(() => {
    if (block.name !== 'edit' && block.name !== 'write') return null;
    if (!resolvedBlock.result) return null;
    try {
      const r =
        typeof resolvedBlock.result === 'string'
          ? JSON.parse(resolvedBlock.result)
          : resolvedBlock.result;
      return r?.value?.diffString ? r.value : null;
    } catch {
      return null;
    }
  }, [block.name, resolvedBlock.result]);

  const filePath = resolvedBlock.input?.file_path
    ? stripWorktreePath(resolvedBlock.input.file_path, worktreePath)
    : null;

  const bashCommand = effectiveName === 'Bash' ? (resolvedBlock.input?.command ?? '') : null;

  // Cursor mcp meta-tool: unwrap and delegate
  if (block.name === 'mcp') {
    return <CursorMcpToolBlock block={block} worktreePath={worktreePath} sessionId={sessionId} />;
  }

  // Baguette MCP tools
  if (block.name?.startsWith('mcp__baguette__')) {
    return <BaguetteMcpToolBlock block={block} sessionId={sessionId} />;
  }

  // TodoWrite / updateTodos
  if (effectiveName === 'TodoWrite' || block.name === 'updateTodos') {
    return <TodoBlock todos={resolvedBlock.input?.todos} />;
  }

  // ExitPlanMode: show the plan inline with Run/Continue planning buttons
  if (effectiveName === 'ExitPlanMode' && resolvedBlock.input) {
    return (
      <ExitPlanModeBlock block={resolvedBlock} sessionId={sessionId} userReplied={userReplied} />
    );
  }

  // AskUserQuestion: show questions inline; user submits answers as a follow-up message
  if (effectiveName === 'AskUserQuestion' && resolvedBlock.input?.questions) {
    return (
      <AskUserQuestionBlock block={resolvedBlock} sessionId={sessionId} userReplied={userReplied} />
    );
  }

  // createPlan: Cursor plan-mode result
  if (block.name === 'createPlan') {
    return <CursorPlanBlock block={resolvedBlock} sessionId={sessionId} />;
  }

  // Task / Agent tool
  if (effectiveName === 'Task' || effectiveName === 'Agent') {
    return <AgentTaskBlock block={resolvedBlock} />;
  }

  // Quiet tools: Glob, Read, Grep + Cursor-only quiet tools
  if (QUIET_TOOLS.has(effectiveName) || CURSOR_QUIET_TOOLS.has(block.name)) {
    let detail;
    const label = effectiveName !== block.name ? effectiveName : block.name;
    if (effectiveName === 'Glob' || block.name === 'ls') {
      detail = resolvedBlock.input?.pattern ?? resolvedBlock.input?.path;
    } else if (effectiveName === 'Grep' || block.name === 'semSearch') {
      detail = [
        resolvedBlock.input?.pattern ?? resolvedBlock.input?.query,
        resolvedBlock.input?.path
          ? stripWorktreePath(resolvedBlock.input.path, worktreePath)
          : null,
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      detail = filePath ?? resolvedBlock.input?.file_path ?? resolvedBlock.input?.path;
    }
    return (
      <QuietToolBlock
        label={label}
        detail={detail}
        isError={resolvedBlock.isError}
        result={resolvedBlock.result}
      />
    );
  }

  // Legacy baguette-op commands (old sessions only)
  const baguetteOp = effectiveName === 'Bash' ? parseBaguetteOp(bashCommand) : null;
  if (baguetteOp) {
    if (QUIET_BAGUETTE_OPS.has(baguetteOp.op)) {
      return (
        <QuietToolBlock
          icon="⚙"
          label={baguetteOp.op}
          isError={resolvedBlock.isError}
          result={resolvedBlock.result}
        />
      );
    }
    if (baguetteOp.op === 'pr-upsert') {
      return (
        <PrUpsertBlock
          title={baguetteOp.arg?.title ?? '(no title)'}
          body={baguetteOp.arg?.body ?? ''}
          result={resolvedBlock.result}
          isError={resolvedBlock.isError}
        />
      );
    }
    if (baguetteOp.op === 'command') {
      return <CommandBlock baguetteOp={baguetteOp} block={resolvedBlock} />;
    }
  }

  if (effectiveName === 'Bash') {
    return (
      <BashToolBlock
        command={bashCommand ?? ''}
        worktreePath={worktreePath}
        block={resolvedBlock}
      />
    );
  }

  const isEditWithDiff =
    effectiveName === 'Edit' &&
    (resolvedBlock.input?.old_string != null || cursorNativeDiff?.diffString != null);
  const isWriteWithContent =
    effectiveName === 'Write' &&
    (resolvedBlock.input?.content != null || cursorNativeDiff?.diffString != null);

  // ExitPlanMode with feedback (isError) should show "continue" badge, not "error"
  const isContinuePlanning = effectiveName === 'ExitPlanMode' && resolvedBlock.isError;

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${resolvedBlock.isError && !isContinuePlanning ? 'border-danger/60' : 'border-line'}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-control/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-accent text-xs font-mono shrink-0">{effectiveName}</span>
          {isContinuePlanning ? (
            <span className="shrink-0 text-info text-xs font-medium bg-soft-info/40 px-1.5 py-0.5 rounded">
              continue
            </span>
          ) : (
            resolvedBlock.isError && (
              <span className="shrink-0 text-danger text-xs font-medium bg-soft-danger/40 px-1.5 py-0.5 rounded">
                error
              </span>
            )
          )}
          {(effectiveName === 'Write' || effectiveName === 'Edit') && filePath && (
            <code className="text-faint text-xs truncate">{filePath}</code>
          )}
          {effectiveName === 'Glob' && resolvedBlock.input?.pattern && (
            <code className="text-faint text-xs truncate">{resolvedBlock.input.pattern}</code>
          )}
          {effectiveName === 'Grep' &&
            (resolvedBlock.input?.pattern || resolvedBlock.input?.path) && (
              <code className="text-faint text-xs truncate">
                {[
                  resolvedBlock.input.pattern,
                  resolvedBlock.input.path
                    ? stripWorktreePath(resolvedBlock.input.path, worktreePath)
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </code>
            )}
        </div>
        {!hasResult ? (
          <div className="w-3.5 h-3.5 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <ChevronDown
            className={`w-4 h-4 text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {isEditWithDiff && !expanded && (
        <EditDiffView
          oldString={resolvedBlock.input?.old_string ?? null}
          newString={resolvedBlock.input?.new_string ?? null}
          cursorDiff={cursorNativeDiff}
          collapsed
          onExpand={() => setExpanded(true)}
        />
      )}
      {isWriteWithContent && !expanded && (
        <EditDiffView
          oldString={resolvedBlock.input?.content != null ? '' : null}
          newString={resolvedBlock.input?.content ?? null}
          cursorDiff={cursorNativeDiff}
          collapsed
          onExpand={() => setExpanded(true)}
          label="Content"
        />
      )}

      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-line text-xs space-y-3">
          {isEditWithDiff ? (
            <EditDiffView
              oldString={resolvedBlock.input?.old_string ?? null}
              newString={resolvedBlock.input?.new_string ?? null}
              cursorDiff={cursorNativeDiff}
            />
          ) : isWriteWithContent ? (
            <EditDiffView
              oldString={resolvedBlock.input?.content != null ? '' : null}
              newString={resolvedBlock.input?.content ?? null}
              cursorDiff={cursorNativeDiff}
              label="Content"
            />
          ) : (
            <div>
              <div className="text-faint font-medium mb-1">Input</div>
              <pre className="text-faint whitespace-pre-wrap overflow-auto max-h-64 bg-page/50 rounded p-2">
                {JSON.stringify(resolvedBlock.input, null, 2)}
              </pre>
            </div>
          )}
          {resolvedBlock.result != null && !cursorNativeDiff && (
            <div>
              <div
                className={`font-medium mb-1 ${isContinuePlanning ? 'text-info' : resolvedBlock.isError ? 'text-danger' : 'text-faint'}`}
              >
                {isContinuePlanning ? 'Feedback' : resolvedBlock.isError ? 'Error' : 'Result'}
              </div>
              <pre
                className={`whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 ${
                  resolvedBlock.isError && !isContinuePlanning
                    ? 'text-danger bg-soft-danger/30'
                    : 'text-fg-muted bg-inset/50'
                }`}
              >
                {typeof resolvedBlock.result === 'string'
                  ? resolvedBlock.result
                  : JSON.stringify(resolvedBlock.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
