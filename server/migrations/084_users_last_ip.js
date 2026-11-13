/**
 * Last client IP / country / seen time for admin user approval UI.
 * Native ALTER TABLE ADD COLUMN (no users table rebuild).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'last_ip'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN last_ip TEXT');
  }
  if (!(await knex.schema.hasColumn('users', 'last_ip_country'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN last_ip_country TEXT');
  }
  if (!(await knex.schema.hasColumn('users', 'last_seen_at'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN last_seen_at DATETIME');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'last_seen_at')) {
    await knex.raw('ALTER TABLE users DROP COLUMN last_seen_at');
  }
  if (await knex.schema.hasColumn('users', 'last_ip_country')) {
    await knex.raw('ALTER TABLE users DROP COLUMN last_ip_country');
  }
  if (await knex.schema.hasColumn('users', 'last_ip')) {
    await knex.raw('ALTER TABLE users DROP COLUMN last_ip');
  }
}
