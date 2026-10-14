/**
 * Remove per-repo builder/reviewer/subagent defaults; account defaults on users remain.
 * Uses native SQLite DROP COLUMN (see AGENTS.md).
 */
const USER_REPO_AGENT_DEFAULT_COLS = [
  'agent_default_config_id',
  'agent_default_model',
  'reviewer_default_config_id',
  'reviewer_default_model',
  'subagent_default_mode',
  'subagent_default_config_id',
  'subagent_default_model',
];

export async function up(knex) {
  for (const name of USER_REPO_AGENT_DEFAULT_COLS) {
    if (await knex.schema.hasColumn('user_repos', name)) {
      await knex.raw(`ALTER TABLE user_repos DROP COLUMN ${name}`);
    }
  }
}

export async function down(knex) {
  const repoCols = [
    'agent_default_config_id INTEGER REFERENCES agent_configs(id)',
    'agent_default_model TEXT',
    'reviewer_default_config_id INTEGER REFERENCES agent_configs(id)',
    'reviewer_default_model TEXT',
    'subagent_default_mode TEXT',
    'subagent_default_config_id INTEGER REFERENCES agent_configs(id)',
    'subagent_default_model TEXT',
  ];
  for (const col of repoCols) {
    const name = col.split(' ')[0];
    if (!(await knex.schema.hasColumn('user_repos', name))) {
      await knex.raw(`ALTER TABLE user_repos ADD COLUMN ${col}`);
    }
  }
}
