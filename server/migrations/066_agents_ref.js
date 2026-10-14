async function backfillRefs(knex, table) {
  const sessionIds = await knex(table).distinct('session_id').pluck('session_id');
  for (const sessionId of sessionIds) {
    const rows = await knex(table)
      .where({ session_id: sessionId })
      .orderBy('id', 'asc')
      .select('id');
    let ref = 0;
    for (const row of rows) {
      ref += 1;
      await knex(table).where({ id: row.id }).update({ ref });
    }
  }
}

export async function up(knex) {
  if (!(await knex.schema.hasColumn('agents', 'ref'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN ref INTEGER');
  }
  await backfillRefs(knex, 'agents');
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS agents_session_id_ref_idx ON agents (session_id, ref)'
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS agents_session_id_ref_idx');
  if (await knex.schema.hasColumn('agents', 'ref')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN ref');
  }
}
