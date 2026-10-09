export async function up(knex) {
  await knex.schema.createTable('session_plans', (t) => {
    t.increments('id').primary();
    t.integer('session_id').notNullable().unique().references('id').inTable('sessions');
    t.text('markdown').notNullable().defaultTo('');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('session_plans');
}
