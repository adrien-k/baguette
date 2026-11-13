/**
 * WebAuthn passkeys as a non-GitHub login method. credential_id is UNIQUE across
 * the instance; transports holds a JSON array of authenticator transports.
 */
export async function up(knex) {
  if (await knex.schema.hasTable('user_passkeys')) return;
  await knex.schema.createTable('user_passkeys', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.text('credential_id').unique().notNullable();
    t.text('public_key').notNullable();
    t.integer('counter').notNullable().defaultTo(0);
    t.text('transports');
    t.string('device_type');
    t.boolean('backed_up').notNullable().defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('user_passkeys');
}
