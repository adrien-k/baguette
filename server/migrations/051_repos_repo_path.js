/** Rename repos.bare_path → repos.repo_path. */
export async function up(knex) {
  await knex.schema.alterTable('repos', (table) => {
    table.renameColumn('bare_path', 'repo_path');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('repos', (table) => {
    table.renameColumn('repo_path', 'bare_path');
  });
}
