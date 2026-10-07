/**
 * Trim message history for sessions already archived before archive-time trimming shipped.
 *
 *   node scripts/2026100603_backfill-trim-archived-session-messages.js
 *
 * For each session with `archived_at` set, applies the same rules as
 * {@link trimSessionMessagesForArchive} (non-chat rows, thinking-only assistants, thinking blocks).
 * Idempotent — safe to re-run.
 */
import { pathToFileURL } from 'node:url';

import Knex from 'knex';
import knexfile from '../knexfile.js';
import {
  ARCHIVE_RETAINED_MESSAGE_TYPES,
  trimSessionMessagesForArchive,
} from '../server/services/session-archive.js';
import { createSessionProgress } from './backfill-progress.js';

/**
 * @param {import('knex').Knex} knex
 * @param {{ reportProgress?: boolean }} [options]
 * @returns {Promise<{ sessions: number, rowsDeleted: number }>}
 */
export async function backfillTrimArchivedSessionMessages(knex, { reportProgress = false } = {}) {
  const archived = await knex('sessions').whereNotNull('archived_at').select('id');
  const sessionIds = archived.map((row) => row.id);

  const progress = reportProgress
    ? createSessionProgress('Trim archived session messages', sessionIds.length)
    : null;

  let rowsDeleted = 0;
  for (const sessionId of sessionIds) {
    const before = await knex('session_messages')
      .where({ session_id: sessionId })
      .whereNotIn('type', ARCHIVE_RETAINED_MESSAGE_TYPES)
      .count({ count: '*' });
    const toDelete = Number(before[0]?.count ?? 0);
    if (toDelete > 0) {
      await trimSessionMessagesForArchive(knex, sessionId);
      rowsDeleted += toDelete;
    }
    progress?.sessionDone();
  }

  progress?.done();
  return { sessions: sessionIds.length, rowsDeleted };
}

async function main() {
  const db = Knex(knexfile);
  try {
    const counts = await backfillTrimArchivedSessionMessages(db, { reportProgress: true });
    console.log(
      `Processed ${counts.sessions} archived session(s); deleted ${counts.rowsDeleted} non-chat message row(s).`
    );
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
