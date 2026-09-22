import logger from '../logger.js';

const TICK_MS = 60_000;
const BATCH_SIZE = 20;

/**
 * Dispatches queued_messages with kind=scheduled once send_at is due.
 * Uses messages.create with a provider so a running turn queues naturally.
 */
export async function dispatchDueScheduledQueuedMessages(app) {
  const db = app.get('db');
  const due = await db('queued_messages')
    .where({ kind: 'scheduled' })
    .where('send_at', '<=', new Date().toISOString())
    .orderBy('send_at', 'asc')
    .limit(BATCH_SIZE);

  for (const row of due) {
    // Atomic claim: overlapping ticks or multiple app instances may see the same row in
    // `due`; only one DELETE succeeds, so a transaction around read-then-delete is unnecessary.
    const claimed = await db('queued_messages').where({ id: row.id, kind: 'scheduled' }).delete();
    if (!claimed) continue;

    try {
      // messages.queueIfRunning only runs when params.provider is set. Use 'rest' so a
      // firing schedule behaves like the user clicking Send: if the turn is still running,
      // the message becomes a kind=turn queued row instead of starting a parallel agent.
      await app.service('messages').create(
        {
          session_id: row.session_id,
          type: 'user',
          message_json: row.message_json,
        },
        { provider: 'rest', user: { id: row.user_id } }
      );
    } catch (err) {
      logger.error(
        { err, queuedId: row.id, sessionId: row.session_id },
        'Failed to send scheduled message after claim'
      );
    }
  }
}

export function startScheduledQueuedMessageSender(app) {
  const tick = () =>
    dispatchDueScheduledQueuedMessages(app).catch((err) =>
      logger.error({ err }, 'Scheduled queued message tick failed')
    );

  const timer = setInterval(tick, TICK_MS);
  tick();

  return () => clearInterval(timer);
}
