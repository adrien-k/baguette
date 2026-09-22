export async function up(knex) {
  await knex.schema.alterTable('queued_messages', (t) => {
    t.string('kind').notNullable().defaultTo('turn');
    t.timestamp('send_at').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('queued_messages', (t) => {
    t.dropColumn('send_at');
    t.dropColumn('kind');
  });
}
