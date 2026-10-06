import { MessageStreamWriter } from '../../shared/message-stream-writer.ts';
import { dbRowFromPayload, dbPatchFromPayload } from '../../shared/message-db-row.js';
import { agentEventLogPath, appendAgentEvent } from './agent-event-log.js';
import type { SessionMessagePayload, SessionMessageRow } from '../../shared/session-messages.ts';
import { claudeBuildToolCallComplete, claudeBuildToolCallStart } from './claude/claude-mapping.ts';
import { cursorBuildToolCallComplete, cursorBuildToolCallStart } from './cursor/cursor-mapping.ts';

/** @param app Feathers application */
export type WriterFactoryApp = {
  service(path: string): {
    create(
      data: Record<string, unknown>,
      params?: Record<string, unknown>
    ): Promise<SessionMessageRow>;
    patch(
      id: number,
      data: Record<string, unknown>,
      params?: Record<string, unknown>
    ): Promise<unknown>;
  };
};

export type MessageWriterOpts = {
  sessionId: number;
  userId: number;
  turnId: number;
  channel: 'chat' | 'review';
  worktreePath?: string | null;
  /** Which provider is producing this turn's stream. */
  agentType: 'claude' | 'cursor';
};

/**
 * Build a MessageStreamWriter bound to the chat or review messages service.
 * @param app - Feathers application
 */
export function createMessageStreamWriter(app: WriterFactoryApp, opts: MessageWriterOpts) {
  const serviceName = opts.channel === 'review' ? 'session-review-messages' : 'messages';
  const userParams = { provider: undefined, user: { id: opts.userId } };
  const logPath = agentEventLogPath({
    sessionId: opts.sessionId,
    worktreePath: opts.worktreePath,
    channel: opts.channel,
    turnId: opts.turnId,
  });

  const builders =
    opts.agentType === 'cursor'
      ? {
          buildToolCallStart: cursorBuildToolCallStart,
          buildToolCallComplete: cursorBuildToolCallComplete,
        }
      : {
          buildToolCallStart: claudeBuildToolCallStart,
          buildToolCallComplete: claudeBuildToolCallComplete,
        };

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
    builders,
  });
}

export type TypedMessageOpts = {
  sessionId: number;
  userId: number;
  turnId?: number | null;
  channel: 'chat' | 'review';
};

/**
 * Persist a typed payload without a full writer (status messages, rejections).
 * @param app - Feathers application
 */
export async function persistTypedMessage(
  app: WriterFactoryApp,
  opts: TypedMessageOpts,
  payload: SessionMessagePayload
) {
  const serviceName = opts.channel === 'review' ? 'session-review-messages' : 'messages';
  const row = dbRowFromPayload(opts.sessionId, opts.turnId ?? null, payload);
  return app.service(serviceName).create(row, {
    provider: undefined,
    user: { id: opts.userId },
  });
}

export { dbPatchFromPayload };
