/**
 * Optional isolated git worktrees for subagents.
 * Plain ADD COLUMN — no table rebuild (SQLite 3.35+).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('agents', 'worktree_path'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN worktree_path TEXT');
  }
  if (!(await knex.schema.hasColumn('agents', 'local_branch'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN local_branch TEXT');
  }
  if (!(await knex.schema.hasColumn('agents', 'initialized'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN initialized INTEGER NOT NULL DEFAULT 0');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('agents', 'initialized')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN initialized');
  }
  if (await knex.schema.hasColumn('agents', 'local_branch')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN local_branch');
  }
  if (await knex.schema.hasColumn('agents', 'worktree_path')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN worktree_path');
  }
}
