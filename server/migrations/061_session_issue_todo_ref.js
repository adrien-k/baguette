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

async function rebuildSessionIssuesRefNotNull(knex) {
  if (!(await knex.schema.hasColumn('session_issues', 'ref'))) {
    await knex.raw('ALTER TABLE session_issues ADD COLUMN ref INTEGER');
  }
  await backfillRefs(knex, 'session_issues');

  await knex.raw('PRAGMA foreign_keys = OFF');
  await knex.schema.raw('DROP INDEX IF EXISTS session_issues_session_id_ref_idx');

  await knex.schema.createTable('session_issues_ref_nn', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.string('severity').notNullable();
    t.string('title').notNullable();
    t.text('description');
    t.string('status').notNullable().defaultTo('opened');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.text('agent_sdk');
    t.text('model');
    t.text('model_params');
    t.integer('ref').notNullable();
  });

  await knex.raw(`
    INSERT INTO session_issues_ref_nn (
      id, session_id, severity, title, description, status, created_at, updated_at,
      agent_sdk, model, model_params, ref
    )
    SELECT
      id, session_id, severity, title, description, status, created_at, updated_at,
      agent_sdk, model, model_params, ref
    FROM session_issues
  `);

  await knex.schema.dropTable('session_issues');
  await knex.schema.renameTable('session_issues_ref_nn', 'session_issues');
  await knex.schema.raw(
    'CREATE UNIQUE INDEX session_issues_session_id_ref_idx ON session_issues (session_id, ref)'
  );
  await knex.raw('PRAGMA foreign_keys = ON');
}

async function rebuildSessionTodosRefNotNull(knex) {
  if (!(await knex.schema.hasColumn('session_todos', 'ref'))) {
    await knex.raw('ALTER TABLE session_todos ADD COLUMN ref INTEGER');
  }
  await backfillRefs(knex, 'session_todos');

  await knex.raw('PRAGMA foreign_keys = OFF');
  await knex.schema.raw('DROP INDEX IF EXISTS session_todos_session_id_ref_idx');

  await knex.schema.createTable('session_todos_ref_nn', (t) => {
    t.increments('id').primary();
    t.integer('session_id').references('id').inTable('sessions').notNullable();
    t.text('content').notNullable();
    t.string('status').notNullable().defaultTo('pending');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.integer('ref').notNullable();
  });

  await knex.raw(`
    INSERT INTO session_todos_ref_nn (
      id, session_id, content, status, sort_order, created_at, updated_at, ref
    )
    SELECT id, session_id, content, status, sort_order, created_at, updated_at, ref
    FROM session_todos
  `);

  await knex.schema.dropTable('session_todos');
  await knex.schema.renameTable('session_todos_ref_nn', 'session_todos');
  await knex.schema.raw(
    'CREATE UNIQUE INDEX session_todos_session_id_ref_idx ON session_todos (session_id, ref)'
  );
  await knex.schema.raw('CREATE INDEX session_todos_session_id_idx ON session_todos (session_id)');
  await knex.raw('PRAGMA foreign_keys = ON');
}

export async function up(knex) {
  await rebuildSessionIssuesRefNotNull(knex);
  await rebuildSessionTodosRefNotNull(knex);
}

export async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS session_issues_session_id_ref_idx');
  await knex.schema.raw('DROP INDEX IF EXISTS session_todos_session_id_ref_idx');
  await knex.raw('ALTER TABLE session_issues DROP COLUMN ref');
  await knex.raw('ALTER TABLE session_todos DROP COLUMN ref');
}
