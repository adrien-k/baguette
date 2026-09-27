/** Shared cleanup after consolidating review-related session columns into 039. */

export function sessionColumnNames(knexResult) {
  const rows = Array.isArray(knexResult) ? knexResult : knexResult[0];
  return rows.map((r) => r.name);
}

/** Drops columns from superseded migrations (039/040/041 review-tracking revisions). */
export async function dropObsoleteSessionReviewColumns(knex) {
  let cols = sessionColumnNames(await knex.raw('PRAGMA table_info(sessions)'));
  if (cols.includes('review_started_commit')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN review_started_commit');
    cols = sessionColumnNames(await knex.raw('PRAGMA table_info(sessions)'));
  }
  if (cols.includes('branch_commit_shas')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN branch_commit_shas');
    cols = sessionColumnNames(await knex.raw('PRAGMA table_info(sessions)'));
  }
  if (cols.includes('last_pushed_commit_sha')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN last_pushed_commit_sha');
  }
}

/** Migration filenames removed when 039 was consolidated (dev DBs may still list these). */
export const OBSOLETE_REVIEW_MIGRATION_NAMES = [
  '039_session_review_started_commit.js',
  '040_drop_review_started_commit.js',
  '041_drop_branch_commit_shas.js',
];
