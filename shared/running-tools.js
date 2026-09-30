/**
 * Collect in-flight tool_use blocks (no stitched tool_result yet) for chat status UI.
 */

const CURSOR_TOOL_ALIAS = {
  shell: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Task',
};

function stripWorktreePath(filePath, worktreePath) {
  if (!filePath || !worktreePath) return filePath;
  const root = worktreePath.endsWith('/') ? worktreePath.slice(0, -1) : worktreePath;
  if (filePath === root || filePath.startsWith(`${root}/`)) {
    return filePath === root ? '.' : `.${filePath.slice(root.length)}`;
  }
  return filePath;
}

function normalizeBlock(block) {
  const effectiveName = CURSOR_TOOL_ALIAS[block.name] ?? block.name;
  if (block.name === 'mcp') {
    const toolName = block.input?.toolName ?? 'mcp';
    return {
      name: `mcp__baguette__${toolName}`,
      input: block.input?.args ?? {},
    };
  }
  if (
    effectiveName !== block.name &&
    (block.name === 'edit' || block.name === 'write' || block.name === 'read')
  ) {
    const inp = block.input ?? {};
    return {
      name: effectiveName,
      input: {
        ...inp,
        file_path: inp.path ?? inp.file_path,
        pattern: inp.pattern ?? inp.query,
      },
    };
  }
  return { name: effectiveName, input: block.input ?? {} };
}

/**
 * @param {object} block - tool_use content block (possibly with result stitched)
 * @param {{ worktreePath?: string }} [opts]
 * @returns {{ label: string; detail?: string }}
 */
export function runningToolDisplay(block, opts = {}) {
  const { worktreePath } = opts;
  const { name, input } = normalizeBlock(block);

  if (name.startsWith('mcp__baguette__')) {
    const short = name.replace('mcp__baguette__', '');
    if (short === 'RunProjectCommand') {
      const label = input.label ?? 'RunProjectCommand';
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

  if (name === 'TodoWrite' || name === 'updateTodos') {
    const inProgress = (input.todos ?? []).find((t) => t.status === 'in_progress');
    return {
      label: 'TodoWrite',
      detail: inProgress?.content ?? undefined,
    };
  }

  return { label: name };
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
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) continue;
    for (const block of msg.message.content) {
      if (block.type !== 'tool_use' || block._hidden) continue;
      if (block.result != null) continue;
      const { label, detail } = runningToolDisplay(block, opts);
      out.push({ id: block.id ?? `${out.length}`, label, detail });
    }
  }

  return out;
}

function isRunningRunProjectCommandBlock(block) {
  if (block.type !== 'tool_use' || block._hidden) return false;
  if (block.result != null) return false;
  if (block.name === 'mcp__baguette__RunProjectCommand') return true;
  if (block.name === 'mcp' && block.input?.toolName === 'RunProjectCommand') return true;
  return false;
}

function isRunningBashToolBlock(block) {
  if (block.type !== 'tool_use' || block._hidden) return false;
  if (block.result != null) return false;
  return block.name === 'Bash' || block.name === 'shell';
}

function isPinnableRunningToolBlock(block) {
  return isRunningBashToolBlock(block) || isRunningRunProjectCommandBlock(block);
}

/**
 * Running Bash/shell and RunProjectCommand blocks pinned above the composer until done.
 * @returns {{ id: string; block: object; startedAt: string | null }[]}
 */
export function collectRunningBashToolsForDock(messages, _chatDisplayItems, opts = {}) {
  const out = [];
  if (!Array.isArray(messages)) return out;

  for (const msg of messages) {
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) continue;
    for (const block of msg.message.content) {
      if (!isPinnableRunningToolBlock(block)) continue;
      out.push({
        id: block.id ?? `dock-${out.length}`,
        block,
        startedAt: msg.created_at ?? null,
      });
    }
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

export function shouldHideRunningBashInFlow(block, pinnedIds) {
  if (!pinnedIds?.size) return false;
  if (!isPinnableRunningToolBlock(block)) return false;
  const id = block.id ?? null;
  return id != null && pinnedIds.has(id);
}
