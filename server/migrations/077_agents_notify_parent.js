/**
 * `agents.notify_parent` — StartSubagent option: when the subagent's turn finishes,
 * Baguette posts its result to the parent agent as a user message. Use with
 * attach: false when the parent will end its turn before the child finishes.
 */

export async function up(knex) {
  if (!(await knex.schema.hasColumn('agents', 'notify_parent'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN notify_parent INTEGER NOT NULL DEFAULT 0');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('agents', 'notify_parent')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN notify_parent');
  }
}
