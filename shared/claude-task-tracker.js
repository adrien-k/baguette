/**
 * Per-turn memory for Claude TaskCreate / TaskUpdate so status-only updates
 * still render the task title (TaskUpdate often sends only taskId + status).
 */

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function contentFromCreateInput(input) {
  const subject = trimStr(input?.subject);
  const description = trimStr(input?.description);
  const content = subject && description ? `${subject}: ${description}` : subject || description;
  const activeForm = trimStr(input?.activeForm ?? input?.active_form) || content;
  return { subject, description, activeForm, content };
}

/** @param {unknown} rawResult */
export function extractClaudeTaskIdFromResult(rawResult) {
  if (rawResult == null) return null;
  let parsed = rawResult;
  if (typeof rawResult === 'string') {
    const m = rawResult.match(/Task\s+#(\d+)/i);
    if (m) return m[1];
    try {
      parsed = JSON.parse(rawResult);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const task = parsed.task ?? parsed.task_use_result?.task;
  if (task && task.id != null) return String(task.id);
  return null;
}

export function createClaudeTaskTracker() {
  /** @type {Map<string, ReturnType<typeof contentFromCreateInput>>} */
  const byTaskId = new Map();

  return {
    registerTaskFromCreateResult(rawResult, createInput) {
      const id = extractClaudeTaskIdFromResult(rawResult);
      if (!id) return;
      byTaskId.set(id, contentFromCreateInput(createInput ?? {}));
    },

    enrichTaskUpdateInput(input) {
      if (!input || input.taskId == null) return input ?? {};
      const id = String(input.taskId);
      const prev = byTaskId.get(id);
      if (!prev) return input;
      const hasText =
        trimStr(input.subject) || trimStr(input.description) || trimStr(input.content);
      if (hasText) return input;
      return {
        ...input,
        subject: prev.subject,
        description: prev.description,
        activeForm: prev.activeForm,
      };
    },
  };
}
