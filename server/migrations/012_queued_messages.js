export async function up(knex) {
  await knex.schema.createTable('queued_messages', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.text('message_json').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTable('queued_messages');
}
