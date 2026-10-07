import { sessionColumnNames } from './lib/session-review-schema-repair.js';

export async function up(knex) {
  const cols = sessionColumnNames(await knex.raw('PRAGMA table_info(sessions)'));
  if (cols.includes('worktree_path') && !cols.includes('session_path')) {
    await knex.schema.alterTable('sessions', (table) => {
      table.renameColumn('worktree_path', 'session_path');
    });
  }
}

export async function down(knex) {
  const cols = sessionColumnNames(await knex.raw('PRAGMA table_info(sessions)'));
  if (cols.includes('session_path') && !cols.includes('worktree_path')) {
    await knex.schema.alterTable('sessions', (table) => {
      table.renameColumn('session_path', 'worktree_path');
    });
  }
}
