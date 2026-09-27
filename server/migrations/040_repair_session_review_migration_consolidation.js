import {
  dropObsoleteSessionReviewColumns,
  sessionColumnNames,
} from './lib/session-review-schema-repair.js';

/** Dev DBs that ran intermediate 039–041 before consolidation. */
export async function up(knex) {
  await dropObsoleteSessionReviewColumns(knex);
}

export async function down(knex) {
  const cols = sessionColumnNames(await knex.raw('PRAGMA table_info(sessions)'));
  if (!cols.includes('review_started_commit')) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN review_started_commit TEXT');
  }
}
