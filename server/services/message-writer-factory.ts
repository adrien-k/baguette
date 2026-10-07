import { MessageStreamWriter } from '../../shared/message-stream-writer.ts';
import { hasNonemptyToolInput } from '../../shared/merge-tool-call-input.js';
import { dbRowFromPayload, dbPatchFromPayload } from '../../shared/message-db-row.js';
import { agentEventLogPath, appendAgentEvent } from './agent-event-log.js';
import type { SessionMessagePayload, SessionMessageRow } from '../../shared/session-messages.ts';
import { claudeBuildToolCallComplete, claudeBuildToolCallStart } from './claude/claude-mapping.ts';
import { cursorBuildToolCallComplete, cursorBuildToolCallStart } from './cursor/cursor-mapping.ts';
import { piBuildToolCallComplete, piBuildToolCallStart } from './pi/pi-mapping.ts';
import { createClaudeTaskTracker } from '../../shared/claude-task-tracker.js';

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
  agentType: 'claude' | 'cursor' | 'pi';
  model: string;
  modelParams?: unknown;
};

function messageIdentityFromChannel(
  channel: 'chat' | 'review',
  agentSdk: 'claude' | 'cursor' | 'pi',
  model: string,
  modelParams?: unknown
) {
  return {
    agent_type: channel === 'review' ? 'reviewer' : 'builder',
    agent_sdk: agentSdk,
    model,
    ...(modelParams != null && agentSdk === 'cursor' ? { model_params: modelParams } : {}),
  };
}

/**
 * Build a MessageStreamWriter bound to the messages service.
 * @param app - Feathers application
 */
export function createMessageStreamWriter(app: WriterFactoryApp, opts: MessageWriterOpts) {
  const userParams = { provider: undefined, user: { id: opts.userId } };
  const identity = messageIdentityFromChannel(
    opts.channel,
    opts.agentType,
    opts.model,
    opts.modelParams
  );
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
      : opts.agentType === 'pi'
        ? {
            buildToolCallStart: piBuildToolCallStart,
            buildToolCallComplete: piBuildToolCallComplete,
          }
        : (() => {
            const taskTracker = createClaudeTaskTracker();
            return {
              buildToolCallStart: (
                callId: string,
                name: string,
                args: Record<string, unknown>,
                startedAt?: string
              ) => {
                const input = args.taskId != null ? taskTracker.enrichTaskUpdateInput(args) : args;
                return claudeBuildToolCallStart(callId, name, input, startedAt);
              },
              buildToolCallComplete: (prev, opts) => {
                const rawArgs = opts.args;
                const isTaskUpdate = rawArgs != null && rawArgs.taskId != null;
                const isTaskCreate =
                  rawArgs != null &&
                  !isTaskUpdate &&
                  (typeof rawArgs.subject === 'string' || typeof rawArgs.description === 'string');
                const input =
                  rawArgs != null && isTaskUpdate
                    ? taskTracker.enrichTaskUpdateInput(rawArgs)
                    : rawArgs;
                const completeArgs =
                  input != null && hasNonemptyToolInput(input) ? input : undefined;
                const completed = claudeBuildToolCallComplete(prev, {
                  ...opts,
                  args: completeArgs,
                });
                if (isTaskCreate) {
                  taskTracker.registerTaskFromCreateResult(opts.rawResult, rawArgs);
                }
                return completed;
              },
            };
          })();

  return new MessageStreamWriter({
    sessionId: opts.sessionId,
    turnId: opts.turnId,
    createRow: async (row) => {
      const created = await app.service('messages').create({ ...row, ...identity }, userParams);
      return { id: created.id };
    },
    patchRow: async (id, patch) => {
      await app.service('messages').patch(id, patch, userParams);
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
  agentSdk?: 'claude' | 'cursor' | 'pi';
  model: string;
  modelParams?: unknown;
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
  const agentSdk = opts.agentSdk ?? 'claude';
  const identity = messageIdentityFromChannel(opts.channel, agentSdk, opts.model, opts.modelParams);
  const row = dbRowFromPayload(opts.sessionId, opts.turnId ?? null, payload, identity);
  return app.service('messages').create(row, {
    provider: undefined,
    user: { id: opts.userId },
  });
}

export { dbPatchFromPayload };
