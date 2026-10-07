/** Message types kept when a session is archived (chat transcript only). */
export const ARCHIVE_RETAINED_MESSAGE_TYPES = ['user', 'assistant'];

function parseAssistantPayload(messageJson) {
  try {
    const payload = JSON.parse(messageJson);
    if (payload?.type !== 'assistant' || !Array.isArray(payload.blocks)) return null;
    return payload;
  } catch {
    return null;
  }
}

function isThinkingOnlyAssistant(blocks) {
  return blocks.length > 0 && blocks.every((block) => block?.type === 'thinking');
}

/**
 * Drop tool calls, system status, plans, turn results, and other non-chat rows.
 * User rows include Baguette-initiated prompts (`source: 'baguette'` in message_json).
 * Assistant rows lose thinking blocks; thinking-only assistant rows are removed.
 */
export async function trimSessionMessagesForArchive(db, sessionId) {
  await db('session_messages')
    .where({ session_id: sessionId })
    .whereNotIn('type', ARCHIVE_RETAINED_MESSAGE_TYPES)
    .delete();

  const assistantRows = await db('session_messages')
    .where({ session_id: sessionId, type: 'assistant' })
    .select('id', 'message_json');

  for (const row of assistantRows) {
    const payload = parseAssistantPayload(row.message_json);
    if (!payload) continue;

    const blocks = payload.blocks;
    if (isThinkingOnlyAssistant(blocks)) {
      await db('session_messages').where({ id: row.id }).delete();
      continue;
    }

    const nextBlocks = blocks.filter((block) => block?.type !== 'thinking');
    if (nextBlocks.length === blocks.length) continue;

    if (nextBlocks.length === 0) {
      await db('session_messages').where({ id: row.id }).delete();
      continue;
    }

    await db('session_messages')
      .where({ id: row.id })
      .update({
        message_json: JSON.stringify({ ...payload, blocks: nextBlocks }),
      });
  }
}
