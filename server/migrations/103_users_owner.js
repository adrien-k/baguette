/**
 * users.owner flag (single-owner invariant). Native ALTER TABLE ADD COLUMN.
 * Backfill: the first user (lowest id) becomes owner (and admin) if no owner exists.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'owner'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN owner INTEGER NOT NULL DEFAULT 0');
  }
  const existingOwner = await knex('users').where({ owner: 1 }).first();
  if (!existingOwner) {
    const firstUser = await knex('users').orderBy('id', 'asc').first();
    if (firstUser) {
      await knex('users').where({ id: firstUser.id }).update({ owner: 1, admin: 1 });
    }
  }
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner_unique ON users (owner) WHERE owner = 1'
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS users_single_owner_unique');
  if (await knex.schema.hasColumn('users', 'owner')) {
    await knex.raw('ALTER TABLE users DROP COLUMN owner');
  }
}
