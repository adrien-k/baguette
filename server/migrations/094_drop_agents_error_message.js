/**
 * Drop `agents.error_message` if an earlier 093 added it. No-op on fresh DBs.
 * Native ALTER TABLE DROP COLUMN — no agents table rebuild (see AGENTS.md).
 */

export async function up(knex) {
  if (await knex.schema.hasColumn('agents', 'error_message')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN error_message');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('agents', 'error_message'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN error_message TEXT');
  }
}
