/**
 * @param { import('knex').Knex } knex
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN mcp_api_token_encrypted TEXT');
}

/**
 * @param { import('knex').Knex } knex
 */
export async function down(knex) {
  await knex.raw('ALTER TABLE users DROP COLUMN mcp_api_token_encrypted');
}
