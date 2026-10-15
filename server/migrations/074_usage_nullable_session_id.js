/**
 * Allow hard-deleting a session while keeping `usage` rows (session_id cleared).
 * Rebuilds `usage` so `session_id` is nullable; native DROP COLUMN cannot relax NOT NULL.
 */

async function tableColumnNames(knex, table) {
  const info = await knex.raw(`PRAGMA table_info(${table})`);
  const rows = Array.isArray(info) ? info : [];
  return rows.map((c) => c.name);
}

async function copyRows(knex, fromTable, toTable) {
  const fromCols = await tableColumnNames(knex, fromTable);
  const toCols = await tableColumnNames(knex, toTable);
  const columns = toCols.filter((name) => fromCols.includes(name));
  if (!columns.length) return;
  const quoted = columns.map((c) => `"${c}"`).join(', ');
  await knex.raw(`INSERT INTO "${toTable}" (${quoted}) SELECT ${quoted} FROM "${fromTable}"`);
}

export async function up(knex) {
  const info = await knex.raw('PRAGMA table_info(usage)');
  const rows = Array.isArray(info) ? info : [];
  const sessionCol = rows.find((c) => c.name === 'session_id');
  if (sessionCol && !sessionCol.notnull) return;

  await knex.raw('PRAGMA foreign_keys = OFF');

  await knex.schema.createTable('usage_nullable_session', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions');
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.string('repo_full_name').notNullable();
    t.decimal('cost_usd', 12, 6).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.string('agent_sdk').notNullable().defaultTo('claude');
    t.integer('input_tokens').notNullable().defaultTo(0);
    t.integer('output_tokens').notNullable().defaultTo(0);
    t.integer('cache_read_tokens').notNullable().defaultTo(0);
    t.integer('cache_write_tokens').notNullable().defaultTo(0);
    t.integer('reasoning_tokens').notNullable().defaultTo(0);
    t.integer('total_tokens').notNullable().defaultTo(0);
    t.string('model');
    t.integer('agent_config_id').references('id').inTable('agent_configs');
    t.integer('agent_id').references('id').inTable('agents');
    t.string('agent_type');
    t.text('model_params');
    t.text('raw_token_usage');
  });

  await copyRows(knex, 'usage', 'usage_nullable_session');
  await knex.schema.dropTable('usage');
  await knex.schema.renameTable('usage_nullable_session', 'usage');
  await knex.raw('PRAGMA foreign_keys = ON');
}

export async function down(knex) {
  const orphaned = await knex('usage').whereNull('session_id').count('* as cnt').first();
  if (Number(orphaned?.cnt ?? 0) > 0) {
    throw new Error('Cannot revert: usage rows exist without session_id');
  }

  await knex.raw('PRAGMA foreign_keys = OFF');

  await knex.schema.createTable('usage_session_required', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.string('repo_full_name').notNullable();
    t.decimal('cost_usd', 12, 6).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.string('agent_sdk').notNullable().defaultTo('claude');
    t.integer('input_tokens').notNullable().defaultTo(0);
    t.integer('output_tokens').notNullable().defaultTo(0);
    t.integer('cache_read_tokens').notNullable().defaultTo(0);
    t.integer('cache_write_tokens').notNullable().defaultTo(0);
    t.integer('reasoning_tokens').notNullable().defaultTo(0);
    t.integer('total_tokens').notNullable().defaultTo(0);
    t.string('model');
    t.integer('agent_config_id').references('id').inTable('agent_configs');
    t.integer('agent_id').references('id').inTable('agents');
    t.string('agent_type');
    t.text('model_params');
    t.text('raw_token_usage');
  });

  await copyRows(knex, 'usage', 'usage_session_required');
  await knex.schema.dropTable('usage');
  await knex.schema.renameTable('usage_session_required', 'usage');
  await knex.raw('PRAGMA foreign_keys = ON');
}
