/**
 * plan_mode removed — planning uses plan.md + ShowPlan instead of SDK plan mode.
 */

async function dropColumnIfExists(knex, table, column) {
  if (await knex.schema.hasColumn(table, column)) {
    await knex.raw(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

export async function up(knex) {
  await dropColumnIfExists(knex, 'sessions', 'plan_mode');
  await dropColumnIfExists(knex, 'loops', 'plan_mode');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'plan_mode'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN plan_mode INTEGER DEFAULT 0');
  }
  if (!(await knex.schema.hasColumn('loops', 'plan_mode'))) {
    await knex.raw('ALTER TABLE loops ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0');
  }
}
