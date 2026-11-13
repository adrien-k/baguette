/**
 * repos.access_mode: 'github' | 'local'. Native ALTER TABLE ADD COLUMN
 * (no rebuild). Backfill: repos without origin are local bare clones, everything
 * else talks to GitHub over HTTPS.
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('repos', 'access_mode')) return;
  await knex.raw("ALTER TABLE repos ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'github'");
  await knex('repos').whereNull('origin').update({ access_mode: 'local' });
}

export async function down(knex) {
  if (await knex.schema.hasColumn('repos', 'access_mode')) {
    await knex.raw('ALTER TABLE repos DROP COLUMN access_mode');
  }
}
