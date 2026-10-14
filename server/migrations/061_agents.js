/**
 * Move per-turn agent state off `sessions` into `agents`. Messages and queued
 * turns reference `agent_id`. Use native SQLite ADD/DROP COLUMN (see AGENTS.md).
 */

async function dropColumnIfExists(knex, table, column) {
  if (await knex.schema.hasColumn(table, column)) {
    await knex.raw(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

function agentTurnStatusFromSessionStatus(status) {
  if (status === 'running' || status === 'approval') return status;
  return 'stopped';
}

function reviewerStatusFromReviewStatus(reviewStatus) {
  if (
    reviewStatus === 'running' ||
    reviewStatus === 'stopped' ||
    reviewStatus === 'completed' ||
    reviewStatus === 'failed' ||
    reviewStatus === 'approval'
  ) {
    return reviewStatus;
  }
  return 'stopped';
}

async function maxTurnIdForAgentType(knex, sessionId, agentType) {
  const row = await knex('session_messages')
    .where({ session_id: sessionId, agent_type: agentType })
    .max('turn_id as max_turn')
    .first();
  const n = Number(row?.max_turn);
  return Number.isFinite(n) ? n : 0;
}

export async function up(knex) {
  if (!(await knex.schema.hasTable('agents'))) {
    await knex.schema.createTable('agents', (t) => {
      t.increments('id').primary();
      t.integer('session_id')
        .references('id')
        .inTable('sessions')
        .notNullable()
        .onDelete('CASCADE');
      t.string('name').notNullable();
      t.string('agent_type').notNullable();
      t.integer('is_primary').notNullable().defaultTo(0);
      t.string('status').notNullable().defaultTo('stopped');
      t.integer('agent_config_id').references('id').inTable('agent_configs');
      t.string('agent_sdk');
      t.text('model');
      t.text('model_params');
      t.string('claude_session_id');
      t.string('cursor_agent_id');
      t.string('pi_session_id');
      t.integer('current_turn_id').notNullable().defaultTo(0);
      t.integer('active_turn_id');
      t.text('initial_prompt');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS agents_session_id_idx ON agents (session_id)');
    await knex.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS agents_session_primary_builder_idx ON agents (session_id) WHERE is_primary = 1'
    );
    await knex.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS agents_session_reviewer_idx ON agents (session_id) WHERE agent_type = 'reviewer'"
    );
  }

  if (!(await knex.schema.hasColumn('session_messages', 'agent_id'))) {
    await knex.raw(
      'ALTER TABLE session_messages ADD COLUMN agent_id INTEGER REFERENCES agents(id)'
    );
  }
  if (!(await knex.schema.hasColumn('queued_messages', 'agent_id'))) {
    await knex.raw('ALTER TABLE queued_messages ADD COLUMN agent_id INTEGER REFERENCES agents(id)');
  }
  if (!(await knex.schema.hasColumn('usage', 'agent_id'))) {
    await knex.raw('ALTER TABLE usage ADD COLUMN agent_id INTEGER REFERENCES agents(id)');
  }

  const sessions = await knex('sessions').select('*');
  /** @type {Map<number, { builderId: number, reviewerId: number | null }>} */
  const agentIdsBySession = new Map();

  for (const session of sessions) {
    const existingBuilder = await knex('agents')
      .where({ session_id: session.id, is_primary: 1 })
      .first();
    let builderId = existingBuilder?.id;
    if (!builderId) {
      const builderTurnMax = await maxTurnIdForAgentType(knex, session.id, 'builder');
      [builderId] = await knex('agents').insert({
        session_id: session.id,
        name: 'Builder',
        agent_type: 'builder',
        is_primary: 1,
        status: agentTurnStatusFromSessionStatus(session.status),
        agent_config_id: session.agent_config_id ?? null,
        agent_sdk: session.agent_sdk ?? null,
        model: session.model ?? null,
        model_params: session.model_params ?? null,
        claude_session_id: session.claude_session_id ?? null,
        cursor_agent_id: session.cursor_agent_id ?? null,
        pi_session_id: session.pi_session_id ?? null,
        current_turn_id: builderTurnMax,
        active_turn_id: session.active_chat_turn_id ?? null,
        initial_prompt: null,
      });
    }

    let reviewerId = null;
    const existingReviewer = await knex('agents')
      .where({ session_id: session.id, agent_type: 'reviewer' })
      .first();
    if (existingReviewer) {
      reviewerId = existingReviewer.id;
    } else {
      const needsReviewer =
        session.review_status != null ||
        session.review_claude_session_id ||
        session.review_cursor_agent_id ||
        session.review_pi_session_id ||
        session.review_agent_config_id != null ||
        session.review_model != null ||
        (await knex('session_messages')
          .where({ session_id: session.id, agent_type: 'reviewer' })
          .first());

      if (needsReviewer) {
        const reviewerTurnMax = await maxTurnIdForAgentType(knex, session.id, 'reviewer');
        [reviewerId] = await knex('agents').insert({
          session_id: session.id,
          name: 'Reviewer',
          agent_type: 'reviewer',
          is_primary: 0,
          status: reviewerStatusFromReviewStatus(session.review_status),
          agent_config_id: session.review_agent_config_id ?? session.agent_config_id ?? null,
          agent_sdk: session.review_agent_sdk ?? session.agent_sdk ?? null,
          model: session.review_model ?? session.model ?? null,
          model_params: session.review_model_params ?? session.model_params ?? null,
          claude_session_id: session.review_claude_session_id ?? null,
          cursor_agent_id: session.review_cursor_agent_id ?? null,
          pi_session_id: session.review_pi_session_id ?? null,
          current_turn_id: reviewerTurnMax,
          active_turn_id: session.active_review_turn_id ?? null,
          initial_prompt: session.review_initial_prompt ?? null,
        });
      }
    }

    agentIdsBySession.set(session.id, { builderId, reviewerId });

    if (session.status === 'running' || session.status === 'approval') {
      await knex('sessions').where({ id: session.id }).update({ status: 'stopped' });
    }
  }

  for (const [sessionId, { builderId, reviewerId }] of agentIdsBySession) {
    await knex('session_messages')
      .where({ session_id: sessionId, agent_type: 'builder' })
      .update({ agent_id: builderId });
    if (reviewerId != null) {
      await knex('session_messages')
        .where({ session_id: sessionId, agent_type: 'reviewer' })
        .update({ agent_id: reviewerId });
    }

    await knex('queued_messages')
      .where({ session_id: sessionId })
      .where((qb) => {
        qb.where('agent_type', 'builder').orWhereNull('agent_type');
      })
      .update({ agent_id: builderId });
    if (reviewerId != null) {
      await knex('queued_messages')
        .where({ session_id: sessionId, agent_type: 'reviewer' })
        .update({ agent_id: reviewerId });
    }

    const usageRows = await knex('usage').where({ session_id: sessionId }).select('id', 'kind');
    for (const row of usageRows) {
      const agentId = row.kind === 'review' && reviewerId != null ? reviewerId : builderId;
      await knex('usage').where({ id: row.id }).update({ agent_id: agentId });
    }
  }

  await knex.raw('DROP INDEX IF EXISTS session_messages_session_tool_call_idx');
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS session_messages_agent_tool_call_idx ON session_messages (agent_id, tool_call_id) WHERE tool_call_id IS NOT NULL'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS session_messages_agent_id_idx ON session_messages (agent_id, id)'
  );

  const sessionDropColumns = [
    'agent_config_id',
    'agent_sdk',
    'model',
    'model_params',
    'review_agent_config_id',
    'review_agent_sdk',
    'review_model',
    'review_model_params',
    'claude_session_id',
    'cursor_agent_id',
    'pi_session_id',
    'review_claude_session_id',
    'review_cursor_agent_id',
    'review_pi_session_id',
    'current_turn_id',
    'active_chat_turn_id',
    'active_review_turn_id',
    'review_status',
    'review_initial_prompt',
    'agent_type',
  ];
  for (const col of sessionDropColumns) {
    await dropColumnIfExists(knex, 'sessions', col);
  }
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS session_messages_agent_id_idx');
  await knex.raw('DROP INDEX IF EXISTS session_messages_agent_tool_call_idx');
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS session_messages_session_tool_call_idx ON session_messages (session_id, tool_call_id) WHERE tool_call_id IS NOT NULL'
  );

  const sessionCols = [
    ['agent_config_id', 'INTEGER REFERENCES agent_configs(id)'],
    ['review_agent_config_id', 'INTEGER REFERENCES agent_configs(id)'],
    ['agent_sdk', 'TEXT'],
    ['review_agent_sdk', 'TEXT'],
    ['model', 'TEXT'],
    ['model_params', 'TEXT'],
    ['review_model', 'TEXT'],
    ['review_model_params', 'TEXT'],
    ['claude_session_id', 'TEXT'],
    ['cursor_agent_id', 'TEXT'],
    ['pi_session_id', 'TEXT'],
    ['review_claude_session_id', 'TEXT'],
    ['review_cursor_agent_id', 'TEXT'],
    ['review_pi_session_id', 'TEXT'],
    ['current_turn_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['active_chat_turn_id', 'INTEGER'],
    ['active_review_turn_id', 'INTEGER'],
    ['review_status', 'TEXT'],
    ['review_initial_prompt', 'TEXT'],
    ['agent_type', "TEXT NOT NULL DEFAULT 'builder'"],
  ];
  for (const [col, type] of sessionCols) {
    if (!(await knex.schema.hasColumn('sessions', col))) {
      await knex.raw(`ALTER TABLE sessions ADD COLUMN ${col} ${type}`);
    }
  }

  if (await knex.schema.hasTable('agents')) {
    const agents = await knex('agents').select('*');
    for (const agent of agents) {
      const patch = {};
      if (agent.is_primary) {
        patch.agent_config_id = agent.agent_config_id;
        patch.agent_sdk = agent.agent_sdk;
        patch.model = agent.model;
        patch.model_params = agent.model_params;
        patch.claude_session_id = agent.claude_session_id;
        patch.cursor_agent_id = agent.cursor_agent_id;
        patch.pi_session_id = agent.pi_session_id;
        patch.active_chat_turn_id = agent.active_turn_id;
        patch.current_turn_id = agent.current_turn_id;
        if (agent.status === 'running' || agent.status === 'approval') {
          patch.status = agent.status;
        }
      }
      if (agent.agent_type === 'reviewer') {
        patch.review_agent_config_id = agent.agent_config_id;
        patch.review_agent_sdk = agent.agent_sdk;
        patch.review_model = agent.model;
        patch.review_model_params = agent.model_params;
        patch.review_claude_session_id = agent.claude_session_id;
        patch.review_cursor_agent_id = agent.cursor_agent_id;
        patch.review_pi_session_id = agent.pi_session_id;
        patch.review_initial_prompt = agent.initial_prompt;
        patch.active_review_turn_id = agent.active_turn_id;
        patch.review_status = agent.status;
      }
      if (Object.keys(patch).length) {
        await knex('sessions').where({ id: agent.session_id }).update(patch);
      }
    }
  }

  await dropColumnIfExists(knex, 'session_messages', 'agent_id');
  await dropColumnIfExists(knex, 'queued_messages', 'agent_id');
  await dropColumnIfExists(knex, 'usage', 'agent_id');
  await knex.schema.dropTableIfExists('agents');
}
