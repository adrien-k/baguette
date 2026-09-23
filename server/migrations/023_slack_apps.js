export async function up(knex) {
  await knex.schema.createTable('slack_apps', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable().unique();
    // Slack bot user OAuth token (xoxb-…), encrypted at rest.
    t.text('bot_token_encrypted').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('slack_apps');
}
