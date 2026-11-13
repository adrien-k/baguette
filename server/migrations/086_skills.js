/** Per-user skills: label + description agents can list, content loaded on demand. */
export async function up(knex) {
  if (await knex.schema.hasTable('skills')) return;
  await knex.schema.createTable('skills', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('label').notNullable();
    t.text('description').notNullable();
    t.text('content').notNullable();
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
    t.unique(['user_id', 'label']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('skills');
}
