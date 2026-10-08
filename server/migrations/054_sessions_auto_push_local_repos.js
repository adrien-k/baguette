/** Local repos cannot auto-push; clear stale true on existing sessions. */
export async function up(knex) {
  const localRepoIds = knex('repos').select('id').whereNull('origin');
  await knex('sessions')
    .whereIn('repo_id', localRepoIds)
    .where('auto_push', 1)
    .update({ auto_push: 0 });
}

export async function down(_knex) {
  // Data fix — cannot restore previous values.
}
