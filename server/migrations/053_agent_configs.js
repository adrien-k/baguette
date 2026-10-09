import {
  accountAgentConfigLabel,
  CLAUDE_TOKEN_LABEL,
  repoAgentConfigLabel,
  repoAgentTokenLabel,
  uniqueAgentConfigLabel,
} from '../../shared/agent-config-labels.js';
import { buildUserRepoDefaultsPatch } from './lib/user-repo-defaults-backfill.js';
import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
} from '../../shared/agent-config-api-key-env.js';
import {
  DEFAULT_PI_API_KEY_ENV_VAR,
  normalizePiApiKeyEnvVar,
} from '../../shared/pi-api-key-env-vars.js';

/** @typedef {{ primary: number | null, token: number | null, cursor: number | null, pi: number | null }} ScopeConfigIds */

/**
 * @param {ScopeConfigIds | undefined} scope
 * @param {string} sdk
 * @returns {number | null}
 */
function pickConfigIdFromScope(scope, sdk) {
  if (!scope) return null;
  if (sdk === 'cursor') return scope.cursor ?? null;
  if (sdk === 'claude') {
    if (scope.token != null && scope.primary == null) return scope.token;
    return scope.primary ?? scope.token ?? null;
  }
  if (sdk === 'pi') return scope.pi ?? null;
  return scope.primary ?? scope.cursor ?? scope.token ?? scope.pi ?? null;
}

/**
 * Pick config id for session/loop backfill after migrating legacy credentials.
 * Prefers repo-scoped configs when present, then account-scoped.
 * @param {ScopeConfigIds | undefined} repoScope
 * @param {ScopeConfigIds | undefined} accountScope
 * @param {string} sdk — session agent_sdk
 */
export function pickAgentConfigIdForSessionBackfill(repoScope, accountScope, sdk) {
  const fromRepo = pickConfigIdFromScope(repoScope, sdk);
  if (fromRepo != null) return fromRepo;
  return pickConfigIdFromScope(accountScope, sdk);
}

function piEnvVarFromRow(raw) {
  try {
    return normalizePiApiKeyEnvVar(raw ?? DEFAULT_PI_API_KEY_ENV_VAR);
  } catch {
    return DEFAULT_PI_API_KEY_ENV_VAR;
  }
}

/**
 * A repo-level base-URL override ran against the account credentials pre-migration
 * ("repo overrides user"), so a link with a base URL but no key of its own inherits the
 * account key — otherwise the repo-scoped config, and with it the base URL, would be lost.
 */
function repoBackfillRow(link, user) {
  if (!link.anthropic_base_url) return link;
  return {
    ...link,
    anthropic_api_key_encrypted:
      link.anthropic_api_key_encrypted || user?.anthropic_api_key_encrypted || null,
    anthropic_auth_token_encrypted:
      link.anthropic_auth_token_encrypted || user?.anthropic_auth_token_encrypted || null,
  };
}

const USER_CRED_COLS = [
  'anthropic_api_key_encrypted',
  'anthropic_auth_token_encrypted',
  'anthropic_base_url',
  'cursor_api_key_encrypted',
];

const USER_REPO_CRED_COLS = [
  'anthropic_api_key_encrypted',
  'anthropic_auth_token_encrypted',
  'anthropic_base_url',
  'cursor_api_key_encrypted',
  'pi_api_key_encrypted',
  'pi_api_key_env_var',
];

async function columnExists(knex, table, column) {
  return knex.schema.hasColumn(table, column);
}

async function dropColumnIfExists(knex, table, column) {
  if (await columnExists(knex, table, column)) {
    await knex.raw(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

/**
 * @param {import('knex').Knex} knex
 * @param {object} opts
 * @param {number} opts.userId
 * @param {Set<string>} opts.usedLabels
 * @param {string} opts.labelBase
 * @param {string} opts.sdk
 * @param {string | null} opts.apiKeyEncrypted
 * @param {string} opts.apiKeyEnvVar
 * @param {string | null} opts.apiUrl
 * @returns {Promise<number | null>} inserted config id
 */
export async function insertAgentConfigRow(
  knex,
  { userId, usedLabels, labelBase, sdk, apiKeyEncrypted, apiKeyEnvVar, apiUrl }
) {
  if (!apiKeyEncrypted) return null;
  const label = uniqueAgentConfigLabel(labelBase, usedLabels);
  usedLabels.add(label.toLowerCase());
  const now = knex.fn.now();
  const [id] = await knex('agent_configs').insert({
    user_id: userId,
    label,
    sdk,
    api_url: apiUrl ?? null,
    api_key_encrypted: apiKeyEncrypted,
    api_key_env_var: apiKeyEnvVar,
    extra_env_json: null,
    created_at: now,
    updated_at: now,
  });
  return id;
}

/** @typedef {{ primary: number | null, token: number | null, cursor: number | null, pi: number | null }} ScopeConfigIds */

/**
 * Backfill configs for one credential scope (user row or user_repos row).
 * The account scope (first caller per user) keeps the bare CLAUDE_TOKEN_LABEL for its
 * auth-token row; repo scopes pass a repo-specific base so the bare label stays unambiguous.
 * @param {import('knex').Knex} knex
 * @param {number} userId
 * @param {object} row — credential-bearing row (user or user_repos)
 * @param {(sdk: string) => string} labelBaseForSdk
 * @param {string} [tokenLabelBase] — label base for the Claude auth-token row
 * @returns {Promise<ScopeConfigIds>}
 */
export async function backfillConfigsForScope(
  knex,
  userId,
  row,
  labelBaseForSdk,
  tokenLabelBase = CLAUDE_TOKEN_LABEL
) {
  const usedLabels = new Set(
    (await knex('agent_configs').where({ user_id: userId }).select('label')).map((r) =>
      r.label.toLowerCase()
    )
  );
  const baseUrl = row.anthropic_base_url ?? null;
  const primaryClaudeId = await insertAgentConfigRow(knex, {
    userId,
    usedLabels,
    labelBase: labelBaseForSdk('claude'),
    sdk: 'claude',
    apiKeyEncrypted: row.anthropic_api_key_encrypted ?? null,
    apiKeyEnvVar: ANTHROPIC_API_KEY_ENV,
    apiUrl: baseUrl,
  });
  const tokenClaudeId = await insertAgentConfigRow(knex, {
    userId,
    usedLabels,
    labelBase: tokenLabelBase,
    sdk: 'claude',
    apiKeyEncrypted: row.anthropic_auth_token_encrypted ?? null,
    apiKeyEnvVar: ANTHROPIC_AUTH_TOKEN_ENV,
    apiUrl: baseUrl,
  });
  const cursorId = await insertAgentConfigRow(knex, {
    userId,
    usedLabels,
    labelBase: labelBaseForSdk('cursor'),
    sdk: 'cursor',
    apiKeyEncrypted: row.cursor_api_key_encrypted ?? null,
    apiKeyEnvVar: null,
    apiUrl: null,
  });
  const piId = await insertAgentConfigRow(knex, {
    userId,
    usedLabels,
    labelBase: labelBaseForSdk('pi'),
    sdk: 'pi',
    apiKeyEncrypted: row.pi_api_key_encrypted ?? null,
    apiKeyEnvVar: piEnvVarFromRow(row.pi_api_key_env_var),
    apiUrl: null,
  });
  return { primary: primaryClaudeId, token: tokenClaudeId, cursor: cursorId, pi: piId };
}

export async function up(knex) {
  await knex.schema.createTable('agent_configs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').notNullable().onDelete('CASCADE');
    t.string('label', 20).notNullable();
    t.string('sdk').notNullable();
    t.text('api_url').nullable();
    t.text('api_key_encrypted').nullable();
    t.string('api_key_env_var').nullable();
    t.text('extra_env_json').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['user_id', 'label']);
  });

  /** @type {Map<number, ScopeConfigIds>} */
  const accountByUser = new Map();
  /** @type {Map<string, ScopeConfigIds>} key `${userId}:${repoId}` */
  const repoScopeByKey = new Map();

  const users = await knex('users').select('*');
  const userById = new Map(users.map((u) => [u.id, u]));
  for (const user of users) {
    const ids = await backfillConfigsForScope(knex, user.id, user, (sdk) =>
      accountAgentConfigLabel(sdk)
    );
    accountByUser.set(user.id, ids);
  }

  const userRepos = await knex('user_repos').select('*');
  for (const link of userRepos) {
    const repo = await knex('repos').where({ id: link.repo_id }).first();
    const fullName = repo?.full_name ?? 'repo';
    const ids = await backfillConfigsForScope(
      knex,
      link.user_id,
      repoBackfillRow(link, userById.get(link.user_id)),
      (sdk) => repoAgentConfigLabel(sdk, fullName),
      repoAgentTokenLabel(fullName)
    );
    repoScopeByKey.set(`${link.user_id}:${link.repo_id}`, ids);
  }

  await knex.raw(
    'ALTER TABLE user_repos ADD COLUMN agent_default_config_id INTEGER REFERENCES agent_configs(id)'
  );
  await knex.raw('ALTER TABLE user_repos ADD COLUMN agent_default_model TEXT');
  await knex.raw(
    'ALTER TABLE user_repos ADD COLUMN reviewer_default_config_id INTEGER REFERENCES agent_configs(id)'
  );
  await knex.raw('ALTER TABLE user_repos ADD COLUMN reviewer_default_model TEXT');

  await knex.raw(
    'ALTER TABLE sessions ADD COLUMN agent_config_id INTEGER REFERENCES agent_configs(id)'
  );
  await knex.raw(
    'ALTER TABLE sessions ADD COLUMN review_agent_config_id INTEGER REFERENCES agent_configs(id)'
  );
  await knex.raw(
    'ALTER TABLE loops ADD COLUMN agent_config_id INTEGER REFERENCES agent_configs(id)'
  );

  const sessions = await knex('sessions').select(
    'id',
    'user_id',
    'repo_id',
    'agent_sdk',
    'review_agent_sdk'
  );
  for (const session of sessions) {
    const account = accountByUser.get(session.user_id);
    const repoScope =
      session.repo_id != null ? repoScopeByKey.get(`${session.user_id}:${session.repo_id}`) : null;
    const sdk = session.agent_sdk || 'claude';
    const reviewSdk = session.review_agent_sdk || sdk;
    const agentConfigId = pickAgentConfigIdForSessionBackfill(repoScope, account, sdk);
    const reviewAgentConfigId = pickAgentConfigIdForSessionBackfill(repoScope, account, reviewSdk);
    const patch = {};
    if (agentConfigId != null) patch.agent_config_id = agentConfigId;
    if (reviewAgentConfigId != null) patch.review_agent_config_id = reviewAgentConfigId;
    if (Object.keys(patch).length) {
      await knex('sessions').where({ id: session.id }).update(patch);
    }
  }

  for (const link of userRepos) {
    const repoScope = repoScopeByKey.get(`${link.user_id}:${link.repo_id}`);
    const patch = await buildUserRepoDefaultsPatch(knex, link, repoScope);
    if (patch) {
      await knex('user_repos').where({ id: link.id }).update(patch);
    }
  }

  const loops = await knex('loops').select('id', 'user_id', 'repo_id', 'agent_sdk');
  for (const loop of loops) {
    const account = accountByUser.get(loop.user_id);
    let repoScope = null;
    if (loop.repo_full_name) {
      const repo = await knex('repos').where({ full_name: loop.repo_full_name }).first();
      if (repo) repoScope = repoScopeByKey.get(`${loop.user_id}:${repo.id}`);
    }
    const sdk = loop.agent_sdk || 'claude';
    const agentConfigId = pickAgentConfigIdForSessionBackfill(repoScope, account, sdk);
    if (agentConfigId != null) {
      await knex('loops').where({ id: loop.id }).update({ agent_config_id: agentConfigId });
    }
  }

  for (const col of USER_CRED_COLS) {
    await dropColumnIfExists(knex, 'users', col);
  }
  // users.agent_defaults is kept here — 055 consumes it to seed users.agent_default_*.
  await dropColumnIfExists(knex, 'users', 'pi_api_key_encrypted');
  await dropColumnIfExists(knex, 'users', 'pi_api_key_env_var');

  for (const col of USER_REPO_CRED_COLS) {
    await dropColumnIfExists(knex, 'user_repos', col);
  }
}

export async function down(knex) {
  for (const col of [...USER_REPO_CRED_COLS].reverse()) {
    if (!(await columnExists(knex, 'user_repos', col))) {
      await knex.raw(`ALTER TABLE user_repos ADD COLUMN ${col} TEXT`);
    }
  }
  if (!(await columnExists(knex, 'users', 'agent_defaults'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN agent_defaults TEXT');
  }
  for (const col of [...USER_CRED_COLS].reverse()) {
    if (!(await columnExists(knex, 'users', col))) {
      await knex.raw(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
    }
  }
  if (!(await columnExists(knex, 'users', 'pi_api_key_encrypted'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN pi_api_key_encrypted TEXT');
  }
  if (!(await columnExists(knex, 'users', 'pi_api_key_env_var'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN pi_api_key_env_var TEXT');
  }

  for (const col of [
    'reviewer_default_model',
    'reviewer_default_config_id',
    'agent_default_model',
    'agent_default_config_id',
  ]) {
    await dropColumnIfExists(knex, 'user_repos', col);
  }

  await dropColumnIfExists(knex, 'loops', 'agent_config_id');
  await dropColumnIfExists(knex, 'sessions', 'review_agent_config_id');
  await dropColumnIfExists(knex, 'sessions', 'agent_config_id');
  await knex.schema.dropTableIfExists('agent_configs');
}
