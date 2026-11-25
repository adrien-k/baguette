/**
 * Public bucket object name. Separate from image_slug so the URL is an
 * unguessable capability, not the placeholder id agents write into the description.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('session_images', 'object_key'))) {
    await knex.raw('ALTER TABLE session_images ADD COLUMN object_key TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('session_images', 'object_key')) {
    await knex.raw('ALTER TABLE session_images DROP COLUMN object_key');
  }
}
