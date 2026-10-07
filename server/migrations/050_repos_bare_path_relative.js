import { normalizeRepoPathForStorage } from '../config.js';

/** Store repos.bare_path relative to DATA_DIR (repos/<stripped>/main); column renamed repo_path in 051. */
export async function up(knex) {
  const rows = await knex('repos').select('id', 'bare_path', 'stripped_name');
  for (const row of rows) {
    const normalized = normalizeRepoPathForStorage(row.bare_path, row.stripped_name);
    if (normalized !== row.bare_path) {
      await knex('repos').where({ id: row.id }).update({ bare_path: normalized });
    }
  }
}

export async function down() {}
