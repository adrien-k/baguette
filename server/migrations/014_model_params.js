export async function up(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'model_params'))) {
    await knex.schema.alterTable('sessions', (t) => {
      t.text('model_params').nullable();
    });
  }

  // Migrate existing JSON-encoded cursor model fields to plain model + model_params
  const rows = await knex('sessions').select('id', 'model').whereNotNull('model');
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.model);
      if (parsed?.id) {
        await knex('sessions')
          .where({ id: row.id })
          .update({
            model: parsed.id,
            model_params: parsed.params?.length ? JSON.stringify(parsed.params) : null,
          });
      }
    } catch {
      // plain string — no migration needed
    }
  }

  // Drop recent_combos (no other table references it)
  await knex.schema.dropTableIfExists('recent_combos');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN model_params');

  // Recreate recent_combos
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
