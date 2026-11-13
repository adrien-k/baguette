/**
 * users.admin flag. Native ALTER TABLE ADD COLUMN (not part of the github_id
 * rebuild in 078). Backfill: currently approved users are admins so existing
 * installs keep today's operators; new rows default to non-admin.
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('users', 'admin')) return;
  await knex.raw('ALTER TABLE users ADD COLUMN admin INTEGER NOT NULL DEFAULT 0');
  await knex('users').where({ approved: 1 }).update({ admin: 1 });
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'admin')) {
    await knex.raw('ALTER TABLE users DROP COLUMN admin');
  }
}
