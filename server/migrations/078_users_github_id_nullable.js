/**
 * users.github_id NOT NULL → NULL so accounts without a GitHub identity can exist
 * (bootstrap + passkey users). SQLite: Knex alterTable/dropColumn would rebuild the
 * table via DROP TABLE users, which fails on the FKs from sessions, usage, user_repos,
 * agent_configs, and secrets — so rebuild manually like 074_usage_nullable_session_id.js:
 * PRAGMA foreign_keys=OFF, create + copy + swap, recreate indexes, PRAGMA foreign_keys=ON.
 * The github_id UNIQUE index is recreated after the swap; SQLite UNIQUE allows multiple
 * NULLs, which is what non-GitHub users need.
 *
 * Runs without a knex transaction: PRAGMA foreign_keys is a no-op inside a
 * transaction, and better-sqlite3 enforces FKs by default, so the DROP TABLE users
 * below would fail otherwise.
 */
export const config = { transaction: false };

const TEMP_UP = 'users_github_id_nullable';
const TEMP_DOWN = 'users_github_id_required';

// Snapshot of the users schema as of 077. Every column must be carried over —
// copyRows refuses to run if the source table has columns this list is missing.
function defineUsersColumns(knex, t, { githubIdNullable }) {
  t.increments('id').primary();
  if (githubIdNullable) {
    t.integer('github_id');
  } else {
    t.integer('github_id').notNullable();
  }
  t.string('username').notNullable();
  t.string('avatar_url');
  t.boolean('approved').defaultTo(false);
  t.string('model').nullable();
  t.string('email').nullable();
  t.string('branch_prefix').notNullable().defaultTo('baguette/');
  t.timestamp('created_at').defaultTo(knex.fn.now());
  t.text('access_token_encrypted').nullable();
  t.text('cursor_model');
  t.text('agent_preferences');
  t.integer('onboarding_completed').notNullable().defaultTo(0);
  t.text('mcp_api_token_encrypted');
  t.text('color_scheme').notNullable().defaultTo('dark');
  t.text('github_token_encrypted');
  t.integer('agent_default_config_id').references('id').inTable('agent_configs');
  t.text('agent_default_model');
  t.integer('reviewer_default_config_id').references('id').inTable('agent_configs');
  t.text('reviewer_default_model');
  t.text('subagent_default_mode');
  t.integer('subagent_default_config_id').references('id').inTable('agent_configs');
  t.text('subagent_default_model');
}

async function tableColumnNames(knex, table) {
  const info = await knex.raw(`PRAGMA table_info(${table})`);
  const rows = Array.isArray(info) ? info : [];
  return rows.map((c) => c.name);
}

async function copyRows(knex, fromTable, toTable) {
  const fromCols = await tableColumnNames(knex, fromTable);
  const toCols = await tableColumnNames(knex, toTable);
  const missing = fromCols.filter((name) => !toCols.includes(name));
  if (missing.length) {
    throw new Error(
      `Refusing to rebuild ${fromTable}: columns would be dropped (${missing.join(', ')})`
    );
  }
  if (!fromCols.length) return;
  const quoted = fromCols.map((c) => `"${c}"`).join(', ');
  await knex.raw(`INSERT INTO "${toTable}" (${quoted}) SELECT ${quoted} FROM "${fromTable}"`);
}

async function swapUsersTable(knex, tempTable, { githubIdNullable }) {
  await knex.raw('PRAGMA foreign_keys = OFF');
  await knex.schema.createTable(tempTable, (t) =>
    defineUsersColumns(knex, t, { githubIdNullable })
  );
  await copyRows(knex, 'users', tempTable);
  await knex.schema.dropTable('users');
  await knex.schema.renameTable(tempTable, 'users');
  await knex.schema.raw('CREATE UNIQUE INDEX users_github_id_unique ON users (github_id)');
  await knex.raw('PRAGMA foreign_keys = ON');
}

async function githubIdColumn(knex) {
  const info = await knex.raw('PRAGMA table_info(users)');
  const rows = Array.isArray(info) ? info : [];
  return rows.find((c) => c.name === 'github_id');
}

export async function up(knex) {
  const githubId = await githubIdColumn(knex);
  if (!githubId || !githubId.notnull) return;
  await swapUsersTable(knex, TEMP_UP, { githubIdNullable: true });
}

export async function down(knex) {
  const githubId = await githubIdColumn(knex);
  if (!githubId || githubId.notnull) return;

  const orphans = await knex('users').whereNull('github_id').count('* as cnt').first();
  if (Number(orphans?.cnt ?? 0) > 0) {
    throw new Error('Cannot revert: users rows exist without github_id');
  }

  await swapUsersTable(knex, TEMP_DOWN, { githubIdNullable: false });
}
