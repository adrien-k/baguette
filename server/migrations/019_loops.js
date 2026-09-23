export async function up(knex) {
  await knex.schema.createTable('loops', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').notNullable();
    t.integer('repo_id').references('id').inTable('repos');
    t.string('repo_full_name').notNullable();
    t.string('name');
    t.string('base_branch').notNullable();
    t.text('prompt').notNullable();

    // Session template — mirrors the columns the builder form fills on `sessions`.
    t.boolean('create_new_branch').notNullable().defaultTo(true);
    t.boolean('auto_push').notNullable().defaultTo(true);
    t.boolean('plan_mode').notNullable().defaultTo(false);
    t.string('permission_mode');
    t.string('agent_sdk');
    t.string('model');
    t.text('model_params');
    t.text('plugins');

    // Recurrence: 'interval' uses interval_minutes, 'daily'/'weekly' use time_of_day
    // (+ days_of_week for 'weekly') interpreted in `timezone`.
    t.string('schedule_type').notNullable();
    t.integer('interval_minutes');
    t.string('time_of_day');
    t.text('days_of_week');
    t.string('timezone').notNullable().defaultTo('UTC');

    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('last_run_at');
    t.timestamp('next_run_at');
    // No FK: a session row can be hard-removed, and a foreign key to `sessions` would make
    // any future rebuild of that table fail (see CLAUDE.md on SQLite migrations).
    t.integer('last_session_id');
    t.text('last_error');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.index(['enabled', 'next_run_at']);
  });
}

export function down(knex) {
  return knex.schema.dropTableIfExists('loops');
}
