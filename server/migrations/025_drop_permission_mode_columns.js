/**
 * permission_mode / default_permission_mode are unused — sessions always auto-approve tools;
 * plan_mode is the only user-facing mode toggle.
 *
 * SQLite: use native DROP COLUMN (see 003_encrypt_access_token.js).
 */

async function dropColumnIfExists(knex, table, column) {
  if (await knex.schema.hasColumn(table, column)) {
    await knex.raw(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

export async function up(knex) {
  await dropColumnIfExists(knex, 'users', 'default_permission_mode');
  await dropColumnIfExists(knex, 'sessions', 'permission_mode');
  await dropColumnIfExists(knex, 'loops', 'permission_mode');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('users', 'default_permission_mode'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN default_permission_mode TEXT');
  }
  if (!(await knex.schema.hasColumn('sessions', 'permission_mode'))) {
    await knex.raw('ALTER TABLE sessions ADD COLUMN permission_mode TEXT');
  }
  if (!(await knex.schema.hasColumn('loops', 'permission_mode'))) {
    await knex.raw('ALTER TABLE loops ADD COLUMN permission_mode TEXT');
  }
}
