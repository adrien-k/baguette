/**
 * Drop account/repo prompt overrides; migrate legacy MCP builder flags to agent_type subagent.
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('agents', 'user_chat_readonly')) {
    await knex.raw(`
      UPDATE agents SET agent_type = 'subagent'
      WHERE user_chat_readonly = 1 AND agent_type = 'builder'
    `);
    await knex.raw('ALTER TABLE agents DROP COLUMN user_chat_readonly');
  }

  if (await knex.schema.hasColumn('agents', 'subagent')) {
    await knex.raw(`
      UPDATE agents SET agent_type = 'subagent'
      WHERE subagent = 1 AND agent_type = 'builder'
    `);
    await knex.raw('ALTER TABLE agents DROP COLUMN subagent');
  }

  if (await knex.schema.hasColumn('users', 'agent_prompt')) {
    await knex.raw('ALTER TABLE users DROP COLUMN agent_prompt');
  }
  if (await knex.schema.hasColumn('users', 'review_prompt')) {
    await knex.raw('ALTER TABLE users DROP COLUMN review_prompt');
  }
  if (await knex.schema.hasColumn('user_repos', 'agent_prompt')) {
    await knex.raw('ALTER TABLE user_repos DROP COLUMN agent_prompt');
  }
  if (await knex.schema.hasColumn('user_repos', 'review_prompt')) {
    await knex.raw('ALTER TABLE user_repos DROP COLUMN review_prompt');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('users', 'agent_prompt'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN agent_prompt TEXT');
  }
  if (!(await knex.schema.hasColumn('users', 'review_prompt'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN review_prompt TEXT');
  }
  if (!(await knex.schema.hasColumn('user_repos', 'agent_prompt'))) {
    await knex.raw('ALTER TABLE user_repos ADD COLUMN agent_prompt TEXT');
  }
  if (!(await knex.schema.hasColumn('user_repos', 'review_prompt'))) {
    await knex.raw('ALTER TABLE user_repos ADD COLUMN review_prompt TEXT');
  }

  await knex.raw(`
    UPDATE agents SET agent_type = 'builder'
    WHERE agent_type = 'subagent'
  `);
}
