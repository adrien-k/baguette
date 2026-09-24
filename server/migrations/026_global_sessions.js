/**
 * Global sessions/loops are not tied to a repository. ADD COLUMN is native SQLite
 * DDL (no table rebuild), so FKs into `sessions` and `loops` stay intact.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'is_global'))) {
    await knex.schema.table('sessions', (t) => {
      t.boolean('is_global').notNullable().defaultTo(false);
    });
  }
  if (!(await knex.schema.hasColumn('loops', 'is_global'))) {
    await knex.schema.table('loops', (t) => {
      t.boolean('is_global').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('sessions', 'is_global')) {
    await knex.raw('ALTER TABLE sessions DROP COLUMN is_global');
  }
  if (await knex.schema.hasColumn('loops', 'is_global')) {
    await knex.raw('ALTER TABLE loops DROP COLUMN is_global');
  }
}
