/**
 * Multiple session plans per session; optional plan links on todos and agents.
 * SQLite: native DDL only (DROP INDEX / ADD COLUMN / CREATE INDEX).
 */

async function backfillSessionPlanRefs(knex) {
  const sessionIds = await knex('session_plans').distinct('session_id').pluck('session_id');
  for (const sessionId of sessionIds) {
    const rows = await knex('session_plans')
      .where({ session_id: sessionId })
      .orderBy('id', 'asc')
      .select('id');
    let ref = 0;
    for (const row of rows) {
      ref += 1;
      await knex('session_plans').where({ id: row.id }).update({ ref });
    }
  }
}

export async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS session_plans_session_id_unique');
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS session_plans_session_id_idx ON session_plans (session_id)'
  );

  if (!(await knex.schema.hasColumn('session_plans', 'ref'))) {
    await knex.raw('ALTER TABLE session_plans ADD COLUMN ref INTEGER');
  }
  await backfillSessionPlanRefs(knex);
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS session_plans_session_id_ref_idx ON session_plans (session_id, ref)'
  );

  if (!(await knex.schema.hasColumn('session_plans', 'status'))) {
    await knex.raw(
      "ALTER TABLE session_plans ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed'))"
    );
  }

  if (!(await knex.schema.hasColumn('session_todos', 'plan_id'))) {
    await knex.raw(
      'ALTER TABLE session_todos ADD COLUMN plan_id INTEGER REFERENCES session_plans(id) ON DELETE SET NULL'
    );
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS session_todos_plan_id_idx ON session_todos (plan_id)');

  if (!(await knex.schema.hasColumn('agents', 'current_plan_id'))) {
    await knex.raw(
      'ALTER TABLE agents ADD COLUMN current_plan_id INTEGER REFERENCES session_plans(id) ON DELETE SET NULL'
    );
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('agents', 'current_plan_id')) {
    await knex.raw('ALTER TABLE agents DROP COLUMN current_plan_id');
  }

  await knex.raw('DROP INDEX IF EXISTS session_todos_plan_id_idx');
  if (await knex.schema.hasColumn('session_todos', 'plan_id')) {
    await knex.raw('ALTER TABLE session_todos DROP COLUMN plan_id');
  }

  await knex.raw('DROP INDEX IF EXISTS session_plans_session_id_ref_idx');
  if (await knex.schema.hasColumn('session_plans', 'ref')) {
    await knex.raw('ALTER TABLE session_plans DROP COLUMN ref');
  }
  if (await knex.schema.hasColumn('session_plans', 'status')) {
    await knex.raw('ALTER TABLE session_plans DROP COLUMN status');
  }

  await knex.raw('DROP INDEX IF EXISTS session_plans_session_id_idx');
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS session_plans_session_id_unique ON session_plans (session_id)'
  );
}
