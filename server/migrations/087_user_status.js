/**
 * Replace users.approved with a single status flag: pending | approved | revoked.
 * Supersedes 079_user_revoked (revoked boolean), which was deleted before it shipped —
 * numbering skips 079. Renumbered to 087 so main's 080_users_admin backfill (which still
 * reads users.approved) runs first. Native SQLite ADD/DROP COLUMN (see AGENTS.md).
 */

const STATUS_CHECK = "status IN ('pending', 'approved', 'revoked')";

export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'status'))) {
    await knex.raw(
      `ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (${STATUS_CHECK})`
    );
  }

  if (await knex.schema.hasColumn('users', 'approved')) {
    await knex('users').where({ approved: 1 }).update({ status: 'approved' });
    await knex.raw('ALTER TABLE users DROP COLUMN approved');
  }
}

export async function down(knex) {
  // Pre-080 shape (001..078): users.approved boolean only. NOT NULL DEFAULT 0
  // backfills existing rows; approved ones flip to 1 below.
  if (!(await knex.schema.hasColumn('users', 'approved'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 0');
  }
  if (await knex.schema.hasColumn('users', 'status')) {
    await knex('users').where({ status: 'approved' }).update({ approved: 1 });
    await knex.raw('ALTER TABLE users DROP COLUMN status');
  }
}
