import { MessageStreamWriter } from '../../shared/message-stream-writer.js';
import { dbRowFromPayload, dbPatchFromPayload } from '../../shared/message-db-row.js';
import { agentEventLogPath, appendAgentEvent } from './agent-event-log.js';

/**
 * @param {import('@feathersjs/feathers').Application} app
 * @param {{
 *   sessionId: number;
 *   userId: number;
 *   turnId: number;
 *   channel: 'chat' | 'review';
 *   worktreePath?: string | null;
 * }} opts
 */
export function createMessageStreamWriter(app, opts) {
  const serviceName = opts.channel === 'review' ? 'session-review-messages' : 'messages';
  const userParams = { provider: undefined, user: { id: opts.userId } };
  const logPath = agentEventLogPath({
    sessionId: opts.sessionId,
    worktreePath: opts.worktreePath,
    channel: opts.channel,
    turnId: opts.turnId,
  });

  return new MessageStreamWriter({
    sessionId: opts.sessionId,
    turnId: opts.turnId,
    createRow: async (row) => {
      const created = await app.service(serviceName).create(row, userParams);
      return { id: created.id };
    },
    patchRow: async (id, patch) => {
      await app.service(serviceName).patch(id, patch, userParams);
    },
    appendRaw: async (event) => {
      await appendAgentEvent(logPath, event);
    },
  });
}

/**
 * Persist a typed payload without a full writer (status messages, rejections).
 */
export async function persistTypedMessage(app, opts, payload) {
  const serviceName = opts.channel === 'review' ? 'session-review-messages' : 'messages';
  const row = dbRowFromPayload(opts.sessionId, opts.turnId ?? null, payload);
  return app.service(serviceName).create(row, {
    provider: undefined,
    user: { id: opts.userId },
  });
}

export { dbPatchFromPayload };
