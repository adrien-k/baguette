import { sessionColumnNames } from './lib/session-review-schema-repair.js';

export async function up(knex) {
  const cols = sessionColumnNames(await knex.raw('PRAGMA table_info(sessions)'));
  if (cols.includes('created_branch') && !cols.includes('local_branch')) {
    await knex.schema.alterTable('sessions', (table) => {
      table.renameColumn('created_branch', 'local_branch');
    });
  }
}

export async function down(knex) {
  const cols = sessionColumnNames(await knex.raw('PRAGMA table_info(sessions)'));
  if (cols.includes('local_branch') && !cols.includes('created_branch')) {
    await knex.schema.alterTable('sessions', (table) => {
      table.renameColumn('local_branch', 'created_branch');
    });
  }
}
