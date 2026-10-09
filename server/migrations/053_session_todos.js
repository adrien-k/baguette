export async function up(knex) {
  await knex.schema.createTable('session_todos', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.text('content').notNullable();
    t.string('status').notNullable().defaultTo('pending');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  await knex.schema.raw('CREATE INDEX session_todos_session_id_idx ON session_todos (session_id)');
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('session_todos');
}
