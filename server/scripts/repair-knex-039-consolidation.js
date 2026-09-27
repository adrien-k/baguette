/**
 * Fixes Knex "migration directory is corrupt" after 039 was renamed/consolidated.
 *
 * 1. Removes obsolete rows from knex_migrations
 * 2. Drops superseded session columns (e.g. review_started_commit)
 *
 * Then run: pnpm run migrate
 */
import knex from 'knex';
import knexfile from '../../knexfile.js';
import {
  dropObsoleteSessionReviewColumns,
  OBSOLETE_REVIEW_MIGRATION_NAMES,
} from '../migrations/lib/session-review-schema-repair.js';

const db = knex(knexfile);

try {
  const deleted = await db('knex_migrations')
    .whereIn('name', OBSOLETE_REVIEW_MIGRATION_NAMES)
    .delete();
  if (deleted > 0) {
    console.log(`Removed ${deleted} obsolete knex_migrations row(s).`);
  } else {
    console.log('No obsolete knex_migrations rows found.');
  }

  await dropObsoleteSessionReviewColumns(db);
  console.log('Dropped superseded session columns (if any).');
  console.log('Run: pnpm run migrate');
} finally {
  await db.destroy();
}
