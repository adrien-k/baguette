/** Message types kept when a session is archived (chat transcript only). */
export const ARCHIVE_RETAINED_MESSAGE_TYPES = ['user', 'assistant'];

/**
 * Drop tool calls, system status, plans, turn results, and other non-chat rows.
 * User rows include Baguette-initiated prompts (`source: 'baguette'` in message_json).
 */
export async function trimSessionMessagesForArchive(db, sessionId) {
  await db('session_messages')
    .where({ session_id: sessionId })
    .whereNotIn('type', ARCHIVE_RETAINED_MESSAGE_TYPES)
    .delete();
}
