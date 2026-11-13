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
      subtype: 'loop',
      message_json: promptMessageJson,
      ...identity,
    },
    userParams
  );
}

/* Claude's compaction (queue + `/compact`) lives in `../claude/loop-compaction.ts`. */
