/**
 * Turn-end observer subscriptions. Unifies the two wake-up scenarios:
 * - subagent `notify_parent` (same-session): rows backfilled from the dropped flag
 * - cross-session watches: session A's primary agent observing session B's primary agent
 *
 * The `agents.notify_parent` flag is dropped with native SQLite DDL — Knex's dropColumn
 * would rebuild the table and stress FKs to `agents` (see AGENTS.md, precedent 061/003).
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('agent_observers'))) {
    await knex.schema.createTable('agent_observers', (t) => {
      t.increments('id').primary();
      t.integer('agent_id').references('id').inTable('agents').notNullable().onDelete('CASCADE');
      t.integer('observer_agent_id')
        .references('id')
        .inTable('agents')
        .notNullable()
        .onDelete('CASCADE');
      t.string('notify_on').notNullable().defaultTo('turn_end');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS agent_observers_pair_idx ON agent_observers (agent_id, observer_agent_id)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS agent_observers_agent_id_idx ON agent_observers (agent_id)'
    );
  }

  // Backfill subagents that had notify_parent set and a parent to report to.
  if (await knex.schema.hasColumn('agents', 'notify_parent')) {
    await knex.raw(
      'INSERT OR IGNORE INTO agent_observers (agent_id, observer_agent_id) SELECT id, parent_agent_id FROM agents WHERE notify_parent = 1 AND parent_agent_id IS NOT NULL'
    );
    await knex.raw('ALTER TABLE agents DROP COLUMN notify_parent');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('agents', 'notify_parent'))) {
    await knex.raw('ALTER TABLE agents ADD COLUMN notify_parent BOOLEAN NOT NULL DEFAULT 0');
    // Only same-session observer pairs map back onto the old flag semantics.
    await knex.raw(
      'UPDATE agents SET notify_parent = 1 WHERE id IN (SELECT ao.agent_id FROM agent_observers ao JOIN agents observed ON observed.id = ao.agent_id JOIN agents observer ON observer.id = ao.observer_agent_id WHERE observer.session_id = observed.session_id)'
    );
  }
  await knex.schema.dropTableIfExists('agent_observers');
}
