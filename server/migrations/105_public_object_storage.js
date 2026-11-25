/**
 * Optional S3-compatible public bucket for PR image URLs when GitHub cannot reach the instance.
 */
export async function up(knex) {
  const instanceCols = [
    'public_storage_endpoint_url',
    'public_storage_bucket',
    'public_storage_region',
    'public_storage_access_key_id',
    'public_storage_secret_access_key_encrypted',
    'public_storage_public_base_url',
  ];
  for (const col of instanceCols) {
    if (!(await knex.schema.hasColumn('instance_settings', col))) {
      await knex.raw(`ALTER TABLE instance_settings ADD COLUMN ${col} TEXT`);
    }
  }
  if (!(await knex.schema.hasColumn('session_images', 'public_url'))) {
    await knex.raw('ALTER TABLE session_images ADD COLUMN public_url TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('session_images', 'public_url')) {
    await knex.raw('ALTER TABLE session_images DROP COLUMN public_url');
  }
  const instanceCols = [
    'public_storage_public_base_url',
    'public_storage_secret_access_key_encrypted',
    'public_storage_access_key_id',
    'public_storage_region',
    'public_storage_bucket',
    'public_storage_endpoint_url',
  ];
  for (const col of instanceCols) {
    if (await knex.schema.hasColumn('instance_settings', col)) {
      await knex.raw(`ALTER TABLE instance_settings DROP COLUMN ${col}`);
    }
  }
}
