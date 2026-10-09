/**
 * Normalise Cursor Task tool `conversationSteps` for UI and message payloads.
 */

export type TaskConversationStep = {
  kind: 'thinking' | 'assistant' | 'tool';
  label: string;
  detail?: string | null;
  tool_name?: string | null;
  status: 'running' | 'completed';
};

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function truncate(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Cursor wraps tool results in `{ status: 'success', value: … }`. */
function unwrapCursorTaskEnvelope(raw: unknown): unknown {
  if (isDict(raw) && raw.status === 'success' && raw.value !== undefined && raw.value !== null) {
    return raw.value;
  }
  return raw;
}

function conversationStepsArray(raw: unknown): unknown[] {
  const unwrapped = unwrapCursorTaskEnvelope(raw);
  if (!isDict(unwrapped)) return [];
  const steps = unwrapped.conversationSteps ?? unwrapped.conversation_steps;
  return Array.isArray(steps) ? steps : [];
}

function toolNameFromCall(toolCall: Dict): string {
  for (const key of Object.keys(toolCall)) {
    if (key.endsWith('ToolCall') && key !== 'toolCall') {
      const base = key.slice(0, -'ToolCall'.length);
      return base || 'tool';
    }
  }
  return 'tool';
}

function toolDetailFromCall(toolCall: Dict): string | null {
  for (const key of Object.keys(toolCall)) {
    if (!key.endsWith('ToolCall')) continue;
    const inner = toolCall[key];
    if (!isDict(inner)) continue;
    const args = inner.args;
    if (!isDict(args)) continue;
    const path = str(args.path ?? args.file_path ?? args.targetDirectory, '');
    if (path) return path;
    const pattern = str(args.globPattern ?? args.pattern ?? args.query, '');
    if (pattern) return pattern;
    const command = str(args.command, '');
    if (command) return truncate(command, 80);
    const toolName = str(args.toolName ?? args.name, '');
    if (toolName) return toolName;
  }
  return null;
}

function toolCallCompleted(toolCall: Dict): boolean {
  if (toolCall.completedAtMs != null || toolCall.completed_at_ms != null) return true;
  for (const key of Object.keys(toolCall)) {
    if (!key.endsWith('ToolCall')) continue;
    const inner = toolCall[key];
    if (isDict(inner) && (inner.result != null || inner.error != null)) return true;
  }
  return false;
}

export function parseCursorTaskConversationSteps(raw: unknown): TaskConversationStep[] {
  const out: TaskConversationStep[] = [];
  for (const step of conversationStepsArray(raw)) {
    if (!isDict(step)) continue;
    if (isDict(step.thinkingMessage)) {
      const text = str(step.thinkingMessage.text);
      if (!text.trim()) continue;
      out.push({
        kind: 'thinking',
        label: truncate(text),
        detail: text.length > 140 ? text : null,
        status: 'completed',
      });
      continue;
    }
    if (isDict(step.assistantMessage)) {
      const text = str(step.assistantMessage.text);
      if (!text.trim()) continue;
      out.push({
        kind: 'assistant',
        label: truncate(text),
        detail: text.length > 140 ? text : null,
        status: 'completed',
      });
      continue;
    }
    if (isDict(step.toolCall)) {
      const tc = step.toolCall;
      const name = toolNameFromCall(tc);
      const detail = toolDetailFromCall(tc);
      const label = detail ? `${name}: ${truncate(detail, 100)}` : name;
      out.push({
        kind: 'tool',
        label,
        detail,
        tool_name: name,
        status: toolCallCompleted(tc) ? 'completed' : 'running',
      });
    }
  }
  return out;
}

function summarizeCursorTaskConversation(steps: TaskConversationStep[]): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind === 'assistant' && s.detail) return s.detail;
    if (s.kind === 'assistant' && s.label) return s.label;
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind === 'thinking' && (s.detail || s.label)) return s.detail ?? s.label;
  }
  return null;
}

export function cursorTaskProgressFromRaw(raw: unknown): {
  steps: TaskConversationStep[];
  step_count: number;
  summary: string | null;
} {
  const steps = parseCursorTaskConversationSteps(raw);
  return {
    steps,
    step_count: steps.length,
    summary: summarizeCursorTaskConversation(steps),
  };
}
