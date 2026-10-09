import type { AgentApp, TiedSessionLoopCompactionArgs } from './agent-service-types.ts';

/** Cursor / Pi: no compaction — send the loop prompt as the next user message. */
export async function directPromptTiedSessionLoopCompaction(
  app: AgentApp,
  args: TiedSessionLoopCompactionArgs
): Promise<void> {
  const { sessionId, promptMessageJson, identity, userParams } = args;
  await app.service('messages').create(
    {
      session_id: sessionId,
      type: 'user',
      message_json: promptMessageJson,
      ...identity,
    },
    userParams
  );
}

/** Claude: queue the loop prompt, then run `/compact` before it is released. */
export async function claudeTiedSessionLoopCompaction(
  app: AgentApp,
  args: TiedSessionLoopCompactionArgs
): Promise<void> {
  const { sessionId, promptMessageJson, identity, userParams } = args;
  const queued = await app.service('queued-messages').create(
    {
      session_id: sessionId,
      message_json: promptMessageJson,
      kind: 'turn',
      ...identity,
    },
    userParams
  );
  try {
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        subtype: 'baguette',
        message_json: JSON.stringify({
          type: 'user',
          source: 'baguette',
          message: { role: 'user', content: '/compact' },
          title: 'Loop run — compacting the conversation',
        }),
        ...identity,
      },
      userParams
    );
  } catch (err) {
    await app
      .service('queued-messages')
      .remove(queued.id, userParams)
      .catch(() => {});
    throw err;
  }
}
