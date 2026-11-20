import {
  MAX_TOOL_RESULT_BYTES,
  isSpilledResultNotice,
  spillToolTextToSessionNotice,
} from './spill-oversized-results.js';

/** @typedef {import('../../../../shared/message-types.ts').ToolCallPayload} ToolCallPayload */

/**
 * Replace oversized inline tool output in a stored tool_call payload with a spill notice.
 *
 * @param {ToolCallPayload} payload
 * @param {{ sessionPath: string }} opts
 * @returns {Promise<ToolCallPayload|null>} patched payload, or null when unchanged
 */
export async function compactOversizedToolCallPayload(payload, { sessionPath }) {
  if (payload?.type !== 'tool_call' || !payload.result) return null;
  const result = payload.result;
  const toolName = payload.name ?? 'tool';
  const kind = payload.kind;

  if (kind === 'mcp' || kind === 'generic') {
    const content = result.content;
    if (typeof content !== 'string' || isSpilledResultNotice(content)) return null;
    if (Buffer.byteLength(content, 'utf8') <= MAX_TOOL_RESULT_BYTES) return null;
    const isError = result.status === 'error';
    const notice = await spillToolTextToSessionNotice(content, {
      sessionPath,
      toolName,
      isError,
    });
    return {
      ...payload,
      result: {
        ...result,
        content: notice,
        ...(kind === 'mcp' ? { data: null } : {}),
      },
    };
  }

  if (kind === 'bash') {
    const stdout = result.stdout;
    if (typeof stdout !== 'string' || isSpilledResultNotice(stdout)) return null;
    if (Buffer.byteLength(stdout, 'utf8') <= MAX_TOOL_RESULT_BYTES) return null;
    const notice = await spillToolTextToSessionNotice(stdout, {
      sessionPath,
      toolName,
      isError: result.status === 'error',
    });
    return {
      ...payload,
      result: {
        ...result,
        stdout: notice,
      },
    };
  }

  return null;
}

/**
 * Backfill spill notices on oversized completed tool_call rows in `session_messages`.
 * Safe to run at the start of each agent turn (idempotent once compacted).
 *
 * @param {import('../../message-writer-factory.ts').WriterFactoryApp} app
 * @param {{ sessionId: number, userId: number, sessionPath: string }} opts
 */
export async function compactOversizedToolCallMessages(app, { sessionId, userId, sessionPath }) {
  if (!sessionPath || !sessionId) return;
  const db = app.get?.('db');
  if (!db) return;

  const rows = await db('session_messages')
    .where({ session_id: sessionId, type: 'tool_call' })
    .whereNotNull('message_json')
    .select('id', 'message_json');

  const userParams = { provider: undefined, user: { id: userId } };
  const messages = app.service('messages');

  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.message_json);
    } catch {
      continue;
    }
    if (payload?.status !== 'completed' && payload?.status !== 'error') continue;
    const next = await compactOversizedToolCallPayload(payload, { sessionPath });
    if (!next) continue;
    await messages.patch(row.id, { message_json: JSON.stringify(next) }, userParams);
  }
}
