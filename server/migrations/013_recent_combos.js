export async function up(knex) {
  await knex.schema.createTable('recent_combos', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.integer('repo_id').references('id').inTable('repos').notNullable();
    t.string('agent_sdk').notNullable();
    t.string('model').notNullable();
    t.text('params').nullable();
    t.integer('variant_id').nullable();
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['user_id', 'repo_id', 'agent_sdk', 'model']);
  });
}

export async function down(knex) {
  await knex.schema.dropTable('recent_combos');
}
