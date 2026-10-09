/**
 * Per-model USD rates (per 1M tokens) for usage cost estimates. Overrides the built-in
 * table in shared/agent-model-pricing.js when present.
 */
export async function up(knex) {
  if (await knex.schema.hasTable('usage_model_pricing')) return;
  await knex.schema.createTable('usage_model_pricing', (t) => {
    t.string('model_id').primary();
    t.float('price_input').notNullable().defaultTo(0);
    t.float('price_cache_write').nullable();
    t.float('price_cache_read').nullable();
    t.float('price_output').notNullable().defaultTo(0);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('usage_model_pricing'))) return;
  await knex.schema.dropTable('usage_model_pricing');
}
