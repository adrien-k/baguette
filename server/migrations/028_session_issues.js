export async function up(knex) {
  await knex.schema.createTable('session_issues', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.string('severity').notNullable();
    t.string('title').notNullable();
    t.text('description');
    t.string('status').notNullable().defaultTo('opened');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('session_review_messages', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.string('type').notNullable();
    t.string('subtype');
    t.string('uuid');
    t.text('message_json').notNullable();
    t.decimal('total_cost_usd', 12, 6);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.raw('ALTER TABLE sessions ADD COLUMN review_status TEXT');
  await knex.raw('ALTER TABLE sessions ADD COLUMN review_agent_sdk TEXT');
  await knex.raw('ALTER TABLE sessions ADD COLUMN review_model TEXT');
  await knex.raw('ALTER TABLE sessions ADD COLUMN review_model_params TEXT');
  await knex.raw('ALTER TABLE users ADD COLUMN review_prompt TEXT');
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('session_review_messages');
  await knex.schema.dropTableIfExists('session_issues');
  await knex.raw('ALTER TABLE sessions DROP COLUMN review_model_params');
  await knex.raw('ALTER TABLE sessions DROP COLUMN review_model');
  await knex.raw('ALTER TABLE sessions DROP COLUMN review_agent_sdk');
  await knex.raw('ALTER TABLE sessions DROP COLUMN review_status');
  await knex.raw('ALTER TABLE users DROP COLUMN review_prompt');
}
