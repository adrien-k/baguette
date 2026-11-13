import { MessageStreamWriter } from '../../shared/message-stream-writer.ts';
import type { ToolCallBuilders } from '../../shared/message-stream-writer.ts';
import { dbRowFromPayload } from '../../shared/message-db-row.js';
import { agentEventLogPath, appendAgentEvent } from './agent-event-log.js';
import type { SessionMessagePayload, SessionMessageRow } from '../../shared/session-messages.ts';
import { getSdkPlugin } from '../agent-sdks/registry.js';

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
  agentId: number;
  channel: 'chat' | 'review';
  sessionPath?: string | null;
  /** Which provider is producing this turn's stream. */
  agentType: string;
  model: string;
  modelParams?: unknown;
  agentConfigId?: number | null;
};

const EMPTY_TOOL_CALL_BUILDERS: ToolCallBuilders = {
  buildToolCallStart() {
    throw new Error('No tool-call builders for this agent SDK');
  },
  buildToolCallComplete(prev) {
    return prev;
  },
};

function messageIdentityFromWriter(
  agentId: number,
  agentSdk: string,
  model: string,
  modelParams?: unknown,
  agentConfigId?: number | null
) {
  const supportsParams = getSdkPlugin(agentSdk)?.supportsModelParams === true;
  return {
    agent_id: agentId,
    agent_sdk: agentSdk,
    model,
    ...(modelParams != null && supportsParams ? { model_params: modelParams } : {}),
    ...(agentConfigId != null ? { agent_config_id: agentConfigId } : {}),
  };
}

/**
 * Build a MessageStreamWriter bound to the messages service.
 * @param app - Feathers application
 */
export function createMessageStreamWriter(app: WriterFactoryApp, opts: MessageWriterOpts) {
  const userParams = { provider: undefined, user: { id: opts.userId } };
  const identity = messageIdentityFromWriter(
    opts.agentId,
    opts.agentType,
    opts.model,
    opts.modelParams,
    opts.agentConfigId
  );
  const logPath = agentEventLogPath({
    sessionId: opts.sessionId,
    sessionPath: opts.sessionPath,
    channel: opts.channel,
    turnId: opts.turnId,
  });

  const plugin = getSdkPlugin(opts.agentType);
  const builders =
    plugin?.toolCallBuilders != null ? plugin.toolCallBuilders() : EMPTY_TOOL_CALL_BUILDERS;

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
  agentId: number;
  turnId?: number | null;
  channel: 'chat' | 'review';
  agentSdk?: string;
  model: string;
  modelParams?: unknown;
  agentConfigId?: number | null;
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
  const agentSdk = opts.agentSdk ?? '';
  const identity = messageIdentityFromWriter(
    opts.agentId,
    agentSdk,
    opts.model,
    opts.modelParams,
    opts.agentConfigId
  );
  const row = dbRowFromPayload(opts.sessionId, opts.turnId ?? null, payload, identity);
  return app.service('messages').create(row, {
    provider: undefined,
    user: { id: opts.userId },
  });
}
