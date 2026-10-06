/**
 * Collect in-flight tool_use blocks (no stitched tool_result yet) for chat status UI.
 */

import { findLastTurnStartIndex } from './turn-model.js';

function stripWorktreePath(filePath, worktreePath) {
  if (!filePath || !worktreePath) return filePath;
  const root = worktreePath.endsWith('/') ? worktreePath.slice(0, -1) : worktreePath;
  if (filePath === root || filePath.startsWith(`${root}/`)) {
    return filePath === root ? '.' : `.${filePath.slice(root.length)}`;
  }
  return filePath;
}

function normalizeBlock(block) {
  // The block's `name` is already canonical PascalCase (the typed row stores
  // it that way). The MCP meta-tool is the one exception: it was historically
  // stored under the bare `mcp` name with the real tool nested inside the
  // args payload.
  if (block.name === 'mcp') {
    const toolName = block.input?.toolName ?? block.input?.tool ?? 'mcp';
    return {
      name: `mcp__baguette__${toolName}`,
      input: block.input?.args ?? block.input ?? {},
    };
  }
  return { name: block.name, kind: block.kind, input: block.input ?? {} };
}

/**
 * @param {object} block - tool_use content block (possibly with result stitched)
 * @param {{ worktreePath?: string }} [opts]
 * @returns {{ label: string; detail?: string }}
 */
export function runningToolDisplay(block, opts = {}) {
  const { worktreePath } = opts;
  const { name, kind, input } = normalizeBlock(block);

  if (name.startsWith('mcp__baguette__')) {
    const short = name.replace('mcp__baguette__', '');
    if (short === 'RunTask') {
      const label = input.label ?? short;
      const args = input.args;
      const detail = Array.isArray(args) && args.length > 0 ? args.join(' ') : undefined;
      return { label, detail };
    }
    if (short === 'PrUpsert') {
      return { label: 'PrUpsert', detail: input.title };
    }
    if (short === 'PrComment') {
      const body = input.body ?? '';
      const preview = body.length > 48 ? `${body.slice(0, 45)}…` : body;
      const path = input.path;
      const line = input.line;
      const detail = path && line != null ? `${path}:${line}` : preview || undefined;
      return { label: path && line != null ? 'PrComment (inline)' : 'PrComment', detail };
    }
    if (short === 'PrReview') {
      return {
        label: `PrReview:${input.event ?? ''}`,
        detail: input.body?.slice(0, 48),
      };
    }
    if (short === 'GitFetch') {
      return { label: short, detail: input.branch };
    }
    if (short === 'PrWorkflowLogs') {
      return { label: short, detail: input.runId != null ? `run ${input.runId}` : undefined };
    }
    if (short === 'ShowDiff') {
      return { label: short, detail: input.path };
    }
    if (short === 'AwaitDetachedTask') {
      const taskId = input.taskId;
      return {
        label: 'AwaitDetachedTask',
        detail: taskId != null ? `task ${taskId}` : undefined,
      };
    }
    return { label: short };
  }

  if (name === 'Bash') {
    const command = input.command ?? '';
    const firstLine =
      command
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) ?? '';
    const trimmed = firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
    return { label: 'Bash', detail: trimmed || undefined };
  }

  if (name === 'Task' || name === 'Agent') {
    const desc = input.description ?? 'Task';
    const sub = input.subagent_type;
    return {
      label: name,
      detail: sub ? `${desc} (${sub})` : desc,
    };
  }

  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    const path = input.file_path ?? input.path;
    return {
      label: name,
      detail: path ? stripWorktreePath(path, worktreePath) : undefined,
    };
  }

  if (name === 'Glob' || name === 'ls') {
    return { label: name === 'ls' ? 'Glob' : name, detail: input.pattern ?? input.path };
  }

  if (name === 'Grep' || name === 'semSearch') {
    const pattern = input.pattern ?? input.query;
    const path = input.path ? stripWorktreePath(input.path, worktreePath) : null;
    const detail = [pattern, path].filter(Boolean).join(' ') || undefined;
    return { label: name === 'semSearch' ? 'Grep' : name, detail };
  }

  if (kind === 'todo' || name === 'TodoWrite') {
    const inProgress = (input.todos ?? []).find((t) => t.status === 'in_progress');
    return {
      label: 'Todo',
      detail: inProgress?.content ?? undefined,
    };
  }

  return { label: name };
}

/**
 * A typed `tool_call` view that is still in flight (no result yet, status not terminal).
 * @param {object} msg - parsed ChatMessageView
 */
function isRunningToolCallView(msg) {
  if (msg.type !== 'tool_call') return false;
  if (msg.tool_status === 'completed' || msg.tool_status === 'error') return false;
  return msg.result == null;
}

/** Stable dock/pinning id for a typed tool_call view. */
function toolCallViewId(msg) {
  return msg.call_id ?? `tool-${msg.id}`;
}

/**
 * @param {object[]} messages - reconciled session messages (visible in chat)
 * @param {{ worktreePath?: string }} [opts]
 * @returns {{ id: string; label: string; detail?: string }[]}
 */
export function collectRunningTools(messages, opts = {}) {
  const out = [];
  if (!Array.isArray(messages)) return out;

  for (const msg of messages) {
    if (msg.type !== 'tool_call') continue;
    if (!isRunningToolCallView(msg)) continue;
    const { label, detail } = runningToolDisplay(
      { name: msg.name, kind: msg.kind, input: msg.args ?? {} },
      opts
    );
    out.push({ id: toolCallViewId(msg), label, detail });
  }

  return out;
}

/** Typed tool_call row pinned to the dock while running: Bash, RunTask, or AwaitDetachedTask. */
function isPinnableRunningToolCallView(msg) {
  if (!isRunningToolCallView(msg)) return false;
  if (msg.kind === 'bash' || msg.name === 'Bash') return true;
  if (msg.kind === 'mcp') {
    const tool = msg.args?.tool ?? msg.args?.toolName;
    return tool === 'RunTask' || tool === 'AwaitDetachedTask';
  }
  return false;
}

/**
 * Running Bash/shell, RunTask, and AwaitDetachedTask blocks pinned above the composer until done.
 * @param {{ worktreePath?: string; sessionTurnActive?: boolean }} [opts]
 * @returns {{ id: string; message: object; startedAt: string | null }[]}
 */
export function collectRunningBashToolsForDock(messages, _chatDisplayItems, opts = {}) {
  const out = [];
  if (!Array.isArray(messages)) return out;
  if (opts.sessionTurnActive === false) return out;

  const turnStart = findLastTurnStartIndex(messages);
  const turnMessages = messages.slice(turnStart);

  for (const msg of turnMessages) {
    if (msg.type !== 'tool_call') continue;
    if (!isPinnableRunningToolCallView(msg)) continue;
    out.push({
      id: toolCallViewId(msg),
      message: msg,
      startedAt: msg.tool_started_at ?? msg.created_at ?? null,
    });
  }

  return out;
}

/** @deprecated alias for tests — use collectRunningBashToolsForDock */
export function collectRunningToolsForBottomBar(messages, chatDisplayItems, opts = {}) {
  return collectRunningBashToolsForDock(messages, chatDisplayItems, opts);
}

export function runningBashToolIds(dockItems) {
  return new Set((dockItems ?? []).map((item) => item.id));
}

/**
 * Hide a pinned running Bash / RunTask / AwaitDetachedTask tool_call row from the flow while it
 * shows in the dock.
 * @param {object} msg - parsed ChatMessageView
 * @param {Set<string>} pinnedIds
 */
export function shouldHideRunningToolCallInFlow(msg, pinnedIds) {
  if (!pinnedIds?.size) return false;
  if (!isPinnableRunningToolCallView(msg)) return false;
  const id = msg.call_id ?? null;
  return id != null && pinnedIds.has(id);
}
