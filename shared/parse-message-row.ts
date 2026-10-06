import { normalizeUserPayloadForStorage } from './normalize-user-payload.js';
import type {
  AssistantBlock,
  AssistantMessagePayload,
  ChatMessageView,
  MessageViewMeta,
  PlanMessagePayload,
  SessionMessageRow,
  SystemMessagePayload,
  ToolCallPayload,
  TurnResultPayload,
  UserMessagePayload,
} from './session-messages.ts';

/**
 * Read assistant blocks out of a legacy raw-SDK `content` array.
 *
 * Only rows written before the typed assistant payload landed can still carry
 * this shape; typed rows already store `{ type: 'assistant', blocks: [...] }`.
 */
function blocksFromLegacyContent(content: unknown): AssistantBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: AssistantBlock[] = [];
  for (const raw of content) {
    if (typeof raw !== 'object' || raw === null) continue;
    const b = raw as { type?: string; text?: string; thinking?: string };
    if (b.type === 'text') blocks.push({ type: 'text', text: b.text ?? '' });
    if (b.type === 'thinking') blocks.push({ type: 'thinking', thinking: b.thinking ?? '' });
  }
  return blocks;
}

/**
 * Merge a DB row + message_json into a client view model for chat, logs, and grouping.
 *
 * @param row - session_messages / session_review_messages row
 */
export function parseMessageRow(row: SessionMessageRow): ChatMessageView {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.message_json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
  } catch {
    payload = {};
  }

  const payloadType = typeof payload.type === 'string' ? payload.type : null;
  const base = { ...row, ...payload, id: row.id } as Record<string, unknown>;
  const meta = base as unknown as MessageViewMeta;

  if (payloadType === 'tool_call' || row.type === 'tool_call') {
    // `message_json` is untrusted JSON: `kind` is re-derived from the payload
    // rather than validated against the union, so this is a boundary cast.
    const call = payload as unknown as ToolCallPayload;
    return {
      ...meta,
      type: 'tool_call',
      kind: call.kind,
      name: call.name,
      status: call.status,
      started_at: call.started_at,
      ended_at: call.ended_at ?? null,
      result: call.result ?? null,
      args: call.args ?? {},
      call_id: (typeof call.id === 'string' ? call.id : null) ?? row.tool_call_id ?? null,
      tool_status: row.tool_status ?? call.status,
      tool_started_at: row.tool_started_at ?? call.started_at,
      tool_ended_at: row.tool_ended_at ?? call.ended_at ?? null,
    } as ChatMessageView;
  }

  if (payloadType === 'assistant' && Array.isArray(payload.blocks)) {
    const typed = payload as unknown as AssistantMessagePayload;
    return { ...meta, type: 'assistant', blocks: typed.blocks };
  }

  if (
    (payloadType === 'assistant' || row.type === 'assistant') &&
    (payload.message != null || payload.content != null)
  ) {
    const envelope = payload.message as { content?: unknown } | undefined;
    const content = envelope?.content ?? payload.content;
    const blocks = blocksFromLegacyContent(content);
    if (blocks.length > 0) {
      return { ...meta, type: 'assistant', blocks };
    }
  }

  if (payloadType === 'user' || row.type === 'user') {
    const normalized = normalizeUserPayloadForStorage({
      ...payload,
      type: 'user',
      subtype: row.subtype ?? (payload.subtype as string | undefined),
    }) as UserMessagePayload & { legacy_tool_result_carrier?: boolean };
    if (normalized.legacy_tool_result_carrier) {
      return { ...meta, type: 'tool_result_carrier' };
    }
    if (typeof normalized.content === 'string') {
      return {
        ...meta,
        type: 'user',
        content: normalized.content,
        source: normalized.source,
        title: normalized.title,
        subtype: row.subtype ?? normalized.subtype ?? null,
      };
    }
    if (Array.isArray(normalized.content)) {
      return {
        ...meta,
        type: 'user',
        content: normalized.content,
        source: normalized.source,
        title: normalized.title,
        subtype: row.subtype ?? normalized.subtype ?? null,
      };
    }
  }

  if (payloadType === 'plan' || row.type === 'plan') {
    const typed = payload as unknown as PlanMessagePayload;
    return { ...meta, type: 'plan', markdown: typed.markdown ?? '' };
  }

  if (
    payloadType === 'turn_result' ||
    row.type === 'turn_result' ||
    payloadType === 'result' ||
    row.type === 'result'
  ) {
    const status: 'ok' | 'error' =
      payloadType === 'result' || row.type === 'result'
        ? (payload as { subtype?: string; is_error?: boolean }).subtype === 'success' &&
          !(payload as { is_error?: boolean }).is_error
          ? 'ok'
          : 'error'
        : (payload as { status?: string }).status === 'error'
          ? 'error'
          : 'ok';
    const typed = payload as Partial<TurnResultPayload>;
    return {
      ...meta,
      type: 'turn_result',
      status,
      error_message:
        status === 'error'
          ? (typed.error_message ??
            String((payload as { result?: unknown }).result ?? 'Turn failed'))
          : null,
      total_cost_usd: typed.total_cost_usd ?? row.total_cost_usd ?? null,
    };
  }

  if (payloadType === 'system' || row.type === 'system') {
    const subtype =
      typeof payload.subtype === 'string' ? payload.subtype : (row.subtype ?? 'system');
    const typed = payload as SystemMessagePayload;
    return {
      ...meta,
      type: 'system',
      subtype,
      status:
        typeof typed.status === 'string'
          ? typed.status
          : typeof payload.message === 'string'
            ? payload.message
            : undefined,
      content: typeof typed.content === 'string' ? typed.content : undefined,
      text: typeof typed.text === 'string' ? typed.text : (payload.text as string | undefined),
      task_status: payload.task_status as string | undefined,
      estimated_tokens: typed.estimated_tokens ?? (payload.estimated_tokens as number | null),
      estimated_tokens_delta: typed.estimated_tokens_delta ?? null,
      tool_use_id: payload.tool_use_id as string | undefined,
      summary: payload.summary as string | undefined,
      description: payload.description as string | undefined,
    };
  }

  return {
    ...meta,
    type: 'system',
    subtype: row.type || payloadType || 'unknown',
    content: JSON.stringify(payload).slice(0, 2000),
  };
}
