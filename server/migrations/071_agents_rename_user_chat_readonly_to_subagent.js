/**
 * Rename legacy user_chat_readonly → subagent (same semantics).
 * Uses native SQLite DROP COLUMN (see CLAUDE.md).
 */
export async function up(knex) {
  const hasSubagent = await knex.schema.hasColumn('agents', 'subagent');
  if (!hasSubagent) {
    await knex.raw('ALTER TABLE agents ADD COLUMN subagent INTEGER NOT NULL DEFAULT 0');
  }
  if (await knex.schema.hasColumn('agents', 'user_chat_readonly')) {
    await knex.raw('UPDATE agents SET subagent = user_chat_readonly');
    await knex.raw('ALTER TABLE agents DROP COLUMN user_chat_readonly');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('agents', 'user_chat_readonly'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN user_chat_readonly INTEGER NOT NULL DEFAULT 0');
  }
  if (await knex.schema.hasColumn('agents', 'subagent')) {
    await knex.raw('UPDATE agents SET user_chat_readonly = subagent');
    await knex.raw('ALTER TABLE agents DROP COLUMN subagent');
  }
}
