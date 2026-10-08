import { gitHubOriginFromFullName } from '../../shared/repo-origin.js';

export async function up(knex) {
  await knex.schema.alterTable('repos', (table) => {
    table.string('origin').nullable();
  });

  const repos = await knex('repos').select('id', 'full_name');
  for (const repo of repos) {
    const origin = gitHubOriginFromFullName(repo.full_name);
    if (origin) {
      await knex('repos').where({ id: repo.id }).update({ origin });
    }
  }
}

export async function down(knex) {
  await knex.schema.alterTable('repos', (table) => {
    table.dropColumn('origin');
  });
}
