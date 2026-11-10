/**
 * Session images uploaded by agents through the `UploadImage` MCP tool.
 * Rows keep the stored upload plus the GitHub attachment URL once the image
 * has been attached to the session pull request, so later PR syncs reference
 * the already-uploaded asset instead of attaching again.
 */
export async function up(knex) {
  if (await knex.schema.hasTable('session_images')) return;
  await knex.schema.createTable('session_images', (t) => {
    t.increments('id').primary();
    t.integer('session_id').notNullable().references('id').inTable('sessions').onDelete('CASCADE');
    t.text('image_slug').notNullable();
    t.text('file_ext').notNullable();
    t.text('media_type').notNullable();
    t.text('alt_text').notNullable();
    t.text('github_url');
    t.datetime('created_at').notNullable();
    t.unique(['image_slug']);
  });
  await knex.schema.table('session_images', (t) => {
    t.index('session_id');
  });
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('session_images'))) return;
  await knex.schema.dropTableIfExists('session_images');
}
