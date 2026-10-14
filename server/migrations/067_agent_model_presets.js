export async function up(knex) {
  if (!(await knex.schema.hasTable('agent_model_presets'))) {
    await knex.schema.createTable('agent_model_presets', (t) => {
      t.increments('id').primary();
      t.integer('user_id').references('id').inTable('users').notNullable().onDelete('CASCADE');
      t.text('description').notNullable();
      t.integer('agent_config_id').references('id').inTable('agent_configs').notNullable();
      t.text('model').notNullable();
      t.text('model_params');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS agent_model_presets_user_id_idx ON agent_model_presets (user_id)'
    );
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('agent_model_presets');
}
