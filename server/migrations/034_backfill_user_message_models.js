import { attachSessionTurnModelFields } from '../../shared/turn-model.js';

/**
 * Backfill model snapshots on older human user messages so chat can show which model ran.
 */
export async function up(knex) {
  const rows = await knex('session_messages')
    .where({ type: 'user' })
    .whereNull('model')
    .select('id', 'session_id', 'message_json');

  for (const row of rows) {
    const data = {
      type: 'user',
      message_json: row.message_json,
    };
    const session = await knex('sessions').where({ id: row.session_id }).first();
    if (!session) continue;
    attachSessionTurnModelFields(data, session);
    if (!data.model) continue;
    await knex('session_messages')
      .where({ id: row.id })
      .update({
        model: data.model,
        model_params: data.model_params ?? null,
      });
  }
}

export async function down() {
  // Non-reversible: we cannot tell which rows were backfilled vs user snapshots.
}
