import { useState, useMemo } from 'react';
import { Bot, CheckSquare2, Square, Loader2 } from 'lucide-react';
import MarkdownContent from '../MarkdownContent.jsx';
import { messagesService, sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import ExitPlanModeBlock from './ExitPlanModeBlock.jsx';
import AskUserQuestionBlock from './AskUserQuestionBlock.jsx';
import { stripWorktreePath } from '../../utils/paths.js';
import { ansiToHtml } from '../../utils/ansi.js';
import EditDiffView from './EditDiffView.jsx';
import BaguetteMcpToolBlock, {
  QuietToolBlock,
  PrUpsertBlock,
  CommandBlock,
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
            className={`flex items-center gap-1.5 text-xs ${isCompleted ? 'text-zinc-600' : isInProgress ? 'text-zinc-300' : 'text-zinc-500'}`}
          >
            {isCompleted ? (
              <CheckSquare2 className="w-3 h-3 shrink-0 text-emerald-700" />
            ) : isInProgress ? (
              <Loader2 className="w-3 h-3 shrink-0 text-amber-500 animate-spin" />
            ) : (
              <Square className="w-3 h-3 shrink-0 text-zinc-700" />
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
      <div className="flex items-center gap-2 py-0.5 pl-1 text-xs text-zinc-500">
        <Bot className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
        <span className="truncate">
          {description}
          {subagentType ? ` (${subagentType})` : ''}
        </span>
        <div className="w-3 h-3 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/50 rounded-lg border border-zinc-800 overflow-hidden">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 text-xs text-zinc-400">
        <Bot className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        <span className="truncate flex-1">
          {description}
          {subagentType ? ` (${subagentType})` : ''}
        </span>
        {!hasResult && (
          <div className="w-3 h-3 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
        )}
      </div>
      {activities.length > 0 && (
        <div className="border-t border-zinc-800/60 px-3 sm:px-4 py-2 font-mono text-[11px] text-zinc-600 space-y-0.5">
          {hidden && (
            <button
              onClick={() => setExpanded(true)}
              className="text-zinc-700 hover:text-zinc-500 transition-colors mb-1"
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
              className="text-zinc-700 hover:text-zinc-500 transition-colors mt-1"
            >
              collapse
            </button>
          )}
        </div>
      )}
      {hasResult && block.result && (
        <div className="border-t border-zinc-800/60 px-3 sm:px-4 py-2 text-xs">
          <div className="text-zinc-500 font-medium mb-1">Result</div>
          <pre className="whitespace-pre-wrap overflow-auto max-h-48 text-zinc-400 bg-zinc-950/50 rounded p-2">
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
  const firstHeading = planMarkdown.split('\n').find((l) => l.startsWith('# '))?.slice(2) ?? 'Plan';

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
    <div className="bg-zinc-900/50 rounded-lg border border-amber-500/20 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 sm:px-4 py-2 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <span className="text-amber-400 text-xs font-mono shrink-0">Plan</span>
        <span className="text-zinc-200 text-xs font-medium truncate flex-1">{firstHeading}</span>
        <svg
          className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && planMarkdown && (
        <div className="px-3 sm:px-4 py-3 border-t border-amber-500/15 text-xs text-zinc-300 overflow-auto max-h-[60vh]">
          <MarkdownContent>{planMarkdown}</MarkdownContent>
        </div>
      )}

      {!continuePlanning && (
        <div className="px-3 sm:px-4 py-2.5 border-t border-amber-500/10 flex gap-2">
          <button
            onClick={handleRun}
            disabled={loading}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
          >
            Run the plan
          </button>
          <button
            onClick={() => setContinuePlanning(true)}
            disabled={loading}
            className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded text-xs font-medium transition-colors"
          >
            Continue planning
          </button>
        </div>
      )}

      {continuePlanning && (
        <div className="px-3 sm:px-4 py-3 border-t border-amber-500/10 space-y-2">
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
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 text-zinc-100 rounded text-xs resize-none focus:outline-none focus:border-zinc-400 placeholder-zinc-500"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={handleContinue}
              disabled={loading}
              className="px-3 py-1.5 bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
            >
              Send feedback
            </button>
            <button
              onClick={() => {
                setContinuePlanning(false);
                setFeedback('');
              }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded text-xs font-medium transition-colors"
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

  const bashResultHtml = useMemo(() => {
    if (effectiveName !== 'Bash') return null;
    const r = resolvedBlock.result;
    if (typeof r === 'string') return ansiToHtml(r);
    if (r && typeof r === 'object') {
      let parsed = r;
      if (typeof r === 'string') {
        try {
          parsed = JSON.parse(r);
        } catch {
          return null;
        }
      }
      const out = [parsed.stdout, parsed.stderr ? `[stderr]\n${parsed.stderr}` : '']
        .filter(Boolean)
        .join('\n');
      return out ? ansiToHtml(out) : null;
    }
    return null;
  }, [effectiveName, resolvedBlock.result]);

  const filePath = resolvedBlock.input?.file_path
    ? stripWorktreePath(resolvedBlock.input.file_path, worktreePath)
    : null;

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
    return <ExitPlanModeBlock block={resolvedBlock} sessionId={sessionId} userReplied={userReplied} />;
  }

  // AskUserQuestion: show questions inline; user submits answers as a follow-up message
  if (effectiveName === 'AskUserQuestion' && resolvedBlock.input?.questions) {
    return <AskUserQuestionBlock block={resolvedBlock} sessionId={sessionId} userReplied={userReplied} />;
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
        resolvedBlock.input?.path ? stripWorktreePath(resolvedBlock.input.path, worktreePath) : null,
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
  const baguetteOp = effectiveName === 'Bash' ? parseBaguetteOp(resolvedBlock.input?.command) : null;
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
      className={`bg-zinc-900/50 rounded-lg border overflow-hidden ${resolvedBlock.isError && !isContinuePlanning ? 'border-red-800/60' : 'border-zinc-800'}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-zinc-800/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 text-xs font-mono shrink-0">{effectiveName}</span>
          {isContinuePlanning ? (
            <span className="shrink-0 text-sky-400 text-xs font-medium bg-sky-950/40 px-1.5 py-0.5 rounded">
              continue
            </span>
          ) : (
            resolvedBlock.isError && (
              <span className="shrink-0 text-red-400 text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
                error
              </span>
            )
          )}
          {effectiveName === 'Bash' && resolvedBlock.input?.command && (
            <code className="text-zinc-400 text-xs truncate">{resolvedBlock.input.command}</code>
          )}
          {(effectiveName === 'Write' || effectiveName === 'Edit') && filePath && (
            <code className="text-zinc-400 text-xs truncate">{filePath}</code>
          )}
          {effectiveName === 'Glob' && resolvedBlock.input?.pattern && (
            <code className="text-zinc-400 text-xs truncate">{resolvedBlock.input.pattern}</code>
          )}
          {effectiveName === 'Grep' &&
            (resolvedBlock.input?.pattern || resolvedBlock.input?.path) && (
              <code className="text-zinc-400 text-xs truncate">
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
          <div className="w-3.5 h-3.5 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <svg
            className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
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
        <div className="px-3 sm:px-4 py-3 border-t border-zinc-800 text-xs space-y-3">
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
              <div className="text-zinc-500 font-medium mb-1">Input</div>
              <pre className="text-zinc-400 whitespace-pre-wrap overflow-auto max-h-64 bg-zinc-950/50 rounded p-2">
                {JSON.stringify(resolvedBlock.input, null, 2)}
              </pre>
            </div>
          )}
          {resolvedBlock.result != null && !cursorNativeDiff && (
            <div>
              <div
                className={`font-medium mb-1 ${isContinuePlanning ? 'text-sky-400' : resolvedBlock.isError ? 'text-red-400' : 'text-zinc-500'}`}
              >
                {isContinuePlanning ? 'Feedback' : resolvedBlock.isError ? 'Error' : 'Result'}
              </div>
              {bashResultHtml != null ? (
                <pre
                  className={`whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 ${
                    resolvedBlock.isError && !isContinuePlanning
                      ? 'text-red-300 bg-red-950/30'
                      : 'text-zinc-300 bg-zinc-950/50'
                  }`}
                  dangerouslySetInnerHTML={{ __html: bashResultHtml }}
                />
              ) : (
                <pre
                  className={`whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 ${
                    resolvedBlock.isError && !isContinuePlanning
                      ? 'text-red-300 bg-red-950/30'
                      : 'text-zinc-400 bg-zinc-950/50'
                  }`}
                >
                  {typeof resolvedBlock.result === 'string'
                    ? resolvedBlock.result
                    : JSON.stringify(resolvedBlock.result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
