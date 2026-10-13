/**
 * Messages and queued rows are scoped by `agent_id` only; backfill then drop `agent_type`.
 */
async function dropColumnIfExists(knex, table, column) {
  if (await knex.schema.hasColumn(table, column)) {
    await knex.raw(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

export async function up(knex) {
  if (!(await knex.schema.hasColumn('session_messages', 'agent_type'))) {
    return;
  }

  const sessions = await knex('sessions').select('id');
  for (const { id: sessionId } of sessions) {
    const builder = await knex('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const reviewer = await knex('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    if (!builder) continue;

    await knex('session_messages')
      .where({ session_id: sessionId, agent_type: 'builder' })
      .update({ agent_id: builder.id });
    await knex('session_messages')
      .where({ session_id: sessionId })
      .whereNull('agent_id')
      .update({ agent_id: builder.id });

    if (reviewer) {
      await knex('session_messages')
        .where({ session_id: sessionId, agent_type: 'reviewer' })
        .update({ agent_id: reviewer.id });
    }

    await knex('queued_messages')
      .where({ session_id: sessionId })
      .where((qb) => {
        qb.where('agent_type', 'builder').orWhereNull('agent_type');
      })
      .update({ agent_id: builder.id });

    if (reviewer) {
      await knex('queued_messages')
        .where({ session_id: sessionId, agent_type: 'reviewer' })
        .update({ agent_id: reviewer.id });
    }
  }

  await dropColumnIfExists(knex, 'session_messages', 'agent_type');
  await dropColumnIfExists(knex, 'queued_messages', 'agent_type');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('session_messages', 'agent_type'))) {
    await knex.raw(
      "ALTER TABLE session_messages ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'builder'"
    );
  }
  if (!(await knex.schema.hasColumn('queued_messages', 'agent_type'))) {
    await knex.raw(
      "ALTER TABLE queued_messages ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'builder'"
    );
  }

  const sessions = await knex('sessions').select('id');
  for (const { id: sessionId } of sessions) {
    const reviewer = await knex('agents')
      .where({ session_id: sessionId, agent_type: 'reviewer' })
      .first();
    if (reviewer) {
      await knex('session_messages')
        .where({ session_id: sessionId, agent_id: reviewer.id })
        .update({ agent_type: 'reviewer' });
      await knex('queued_messages')
        .where({ session_id: sessionId, agent_id: reviewer.id })
        .update({ agent_type: 'reviewer' });
    }
    await knex('session_messages')
      .where({ session_id: sessionId })
      .where((qb) => {
        if (reviewer) qb.whereNot('agent_id', reviewer.id);
      })
      .update({ agent_type: 'builder' });
    await knex('queued_messages')
      .where({ session_id: sessionId })
      .where((qb) => {
        if (reviewer) qb.whereNot('agent_id', reviewer.id);
      })
      .update({ agent_type: 'builder' });
  }
}
