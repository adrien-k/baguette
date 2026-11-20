/* eslint-disable no-console -- dev seed CLI progress */
/**
 * Seed the local dev SQLite database: dev user, agent configs (from SDK_TESTS_* env),
 * a local repo, and sample sessions with varied subagents. Idempotent when the dev
 * user already exists (skipped unless `force` is set).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { DATA_DIR, REPOS_DIR, normalizeRepoPathForStorage, storedRepoPath } from '../config.js';
import { initLocalRepo } from '../services/github.js';
import { insertTestAgentConfig } from '../test-utils/agent-configs.js';
import { readLiveSdkEnv } from '../test-utils/sdk-live-env.js';
import { insertSessionWithPrimaryBuilder } from '../test-utils/session-agents.js';
import { insertAgentObserver } from '../services/agents-db.js';
import { provisionIsolatedSubagentWorktree } from '../services/subagent-worktree.js';
import { ensureMockAgentConfig } from '../agent-sdks/mock/mock-agent-config.js';
import { isMockAgentSdkEnabled } from '../../shared/mock-agent-sdk.js';
import { stringifyAgentDefaultModel } from '../../shared/agent-default-model.js';
import { stringifyModelParamsForStorage } from '../../shared/agent-session-defaults.js';
import { USER_STATUS_APPROVED } from '../../shared/user-status.js';
import { accountAgentConfigLabel } from '../../shared/agent-config-labels.js';
import { encrypt } from './encrypt.js';

const execFileAsync = promisify(execFile);

export const DEV_SEED_EMAIL = 'dev@baguette.local';
export const DEV_SEED_USERNAME = 'dev';
export const DEV_REPO_FULL_NAME = 'baguette-dev';
export const DEV_REPO_STRIPPED = 'baguette-dev';

const LIVE_SDKS = ['claude', 'cursor', 'pi'];

async function defaultBranchForRepo(repoAbs) {
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: repoAbs,
      stdio: 'pipe',
    });
    const branch = stdout.trim();
    return branch || 'main';
  } catch {
    return 'main';
  }
}

function sessionWorktreeAbs(strippedName, shortId) {
  return path.join(REPOS_DIR, strippedName, 'sessions', shortId, 'worktree');
}

function sessionWorktreeStored(strippedName, shortId) {
  return `repos/${strippedName}/sessions/${shortId}/worktree`;
}

async function ensureSessionGitWorktree(mainRepoAbs, strippedName, shortId, branch) {
  const worktreeAbs = sessionWorktreeAbs(strippedName, shortId);
  await execFileAsync('git', ['worktree', 'add', '--detach', worktreeAbs, branch], {
    cwd: mainRepoAbs,
    stdio: 'pipe',
  });
  return {
    absolute: worktreeAbs,
    stored: sessionWorktreeStored(strippedName, shortId),
  };
}

/** @returns {Promise<Map<string, { id: number, env: ReturnType<typeof readLiveSdkEnv> }>>} */
async function ensureLiveSdkAgentConfigs(db, userId) {
  const configs = new Map();
  for (const sdk of LIVE_SDKS) {
    const env = readLiveSdkEnv(sdk);
    if (!env.enabled) continue;
    const id = await insertTestAgentConfig(db, userId, {
      sdk,
      label: accountAgentConfigLabel(sdk),
      apiKey: env.apiKey,
      apiKeyEnvVar: env.apiKeyEnvVar,
      apiUrl: env.apiUrl,
    });
    configs.set(sdk, { id, env });
  }
  if (isMockAgentSdkEnabled()) {
    const mockId = await ensureMockAgentConfig(db, userId);
    if (mockId) {
      configs.set('mock', {
        id: mockId,
        env: readLiveSdkEnv('mock'),
      });
    }
  }
  return configs;
}

function pickDefaultConfig(configs) {
  if (configs.has('mock')) return configs.get('mock');
  if (configs.has('cursor')) return configs.get('cursor');
  if (configs.has('claude')) return configs.get('claude');
  if (configs.has('pi')) return configs.get('pi');
  return null;
}

async function insertDevUser(db, devGhKey) {
  const [userId] = await db('users').insert({
    github_id: 0,
    username: DEV_SEED_USERNAME,
    email: DEV_SEED_EMAIL,
    access_token_encrypted: devGhKey ? encrypt(devGhKey) : null,
    status: USER_STATUS_APPROVED,
    admin: 1,
    onboarding_completed: 1,
    subagent_default_mode: 'preset',
  });
  return userId;
}

async function applyDevUserDefaults(db, userId, defaultConfig) {
  if (!defaultConfig) return;
  const defaultModelJson = stringifyAgentDefaultModel({
    model: defaultConfig.env.model,
    model_params: defaultConfig.env.modelParams,
  });
  await db('users').where({ id: userId }).update({
    agent_default_config_id: defaultConfig.id,
    agent_default_model: defaultModelJson,
    reviewer_default_config_id: defaultConfig.id,
    reviewer_default_model: defaultModelJson,
  });
}

async function ensureDevRepo(db, userId) {
  const repoAbs = await initLocalRepo(DEV_REPO_STRIPPED);
  const defaultBranch = await defaultBranchForRepo(repoAbs);
  const repoPathStored = normalizeRepoPathForStorage(repoAbs, DEV_REPO_STRIPPED);
  const [repoId] = await db('repos').insert({
    full_name: DEV_REPO_FULL_NAME,
    stripped_name: DEV_REPO_STRIPPED,
    repo_path: repoPathStored || storedRepoPath(DEV_REPO_STRIPPED),
    default_branch: defaultBranch,
    last_fetched_at: db.fn.now(),
    origin: null,
    access_mode: 'local',
  });
  await db('user_repos').insert({
    user_id: userId,
    repo_id: repoId,
    show_in_all_sessions: 0,
  });
  return {
    id: repoId,
    full_name: DEV_REPO_FULL_NAME,
    stripped_name: DEV_REPO_STRIPPED,
    repo_path: repoPathStored || storedRepoPath(DEV_REPO_STRIPPED),
    default_branch: defaultBranch,
    access_mode: 'local',
    origin: null,
    mainAbs: repoAbs,
  };
}

async function insertExtraAgent(db, sessionId, primaryRow, spec) {
  const [id] = await db('agents').insert({
    session_id: sessionId,
    ref: spec.ref,
    name: spec.name,
    agent_type: spec.agent_type,
    is_primary: 0,
    status: spec.status,
    agent_config_id: spec.agent_config_id ?? primaryRow.agent_config_id,
    agent_sdk: spec.agent_sdk ?? primaryRow.agent_sdk,
    model: spec.model ?? primaryRow.model,
    model_params: spec.model_params ?? primaryRow.model_params,
    current_turn_id: spec.current_turn_id ?? 0,
    initial_prompt: spec.initial_prompt ?? null,
    parent_agent_id: spec.parent_agent_id ?? null,
    worktree_path: spec.worktree_path ?? null,
    local_branch: spec.local_branch ?? null,
  });
  return id;
}

async function seedShowcaseSession(db, userId, repo, configs) {
  const mock = configs.get('mock') ?? pickDefaultConfig(configs);
  if (!mock) return;

  const shortId = 'devhub1';
  const branch = repo.default_branch;
  await ensureSessionGitWorktree(repo.mainAbs, DEV_REPO_STRIPPED, shortId, branch);

  const modelParams = stringifyModelParamsForStorage(mock.env.modelParams);
  const sessionId = await insertSessionWithPrimaryBuilder(db, {
    user_id: userId,
    repo_id: repo.id,
    repo_full_name: DEV_REPO_FULL_NAME,
    base_branch: branch,
    short_id: shortId,
    label: 'Dev hub (mock agents)',
    initial_prompt: 'Local dev seed — explore subagents in the sidebar.',
    status: 'stopped',
    session_path: sessionWorktreeStored(DEV_REPO_STRIPPED, shortId),
    auto_push: 0,
    agent_config_id: mock.id,
    agent_sdk: 'mock',
    model: mock.env.model,
    model_params: modelParams,
    last_activity_at: db.fn.now(),
  });

  await db('agents').where({ session_id: sessionId, is_primary: 1 }).update({ ref: 1 });
  const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();

  await insertExtraAgent(db, sessionId, primary, {
    ref: 2,
    name: 'Reviewer',
    agent_type: 'reviewer',
    status: 'stopped',
  });

  await insertExtraAgent(db, sessionId, primary, {
    ref: 3,
    name: 'Research scout',
    agent_type: 'subagent',
    status: 'completed',
    parent_agent_id: primary.id,
    initial_prompt: 'Survey the repo README for dev seed smoke.',
  });

  await insertExtraAgent(db, sessionId, primary, {
    ref: 4,
    name: 'Manual builder',
    agent_type: 'builder',
    status: 'stopped',
    initial_prompt: 'Extra builder spawned from the composer.',
  });

  const notifyId = await insertExtraAgent(db, sessionId, primary, {
    ref: 5,
    name: 'Notify helper',
    agent_type: 'subagent',
    status: 'stopped',
    parent_agent_id: primary.id,
    initial_prompt: 'MCP subagent with notify_parent observer.',
  });
  await insertAgentObserver(db, { agentId: notifyId, observerAgentId: primary.id });

  await insertExtraAgent(db, sessionId, primary, {
    ref: 6,
    name: 'Running worker',
    agent_type: 'subagent',
    status: 'running',
    parent_agent_id: primary.id,
    initial_prompt: 'Simulated in-flight subagent for navbar counts.',
  });

  await insertExtraAgent(db, sessionId, primary, {
    ref: 7,
    name: 'Failed attempt',
    agent_type: 'subagent',
    status: 'failed',
    parent_agent_id: primary.id,
    initial_prompt: 'Subagent that ended in failed status.',
  });

  const sessionRow = await db('sessions').where({ id: sessionId }).first();
  const isolatedId = await insertExtraAgent(db, sessionId, primary, {
    ref: 8,
    name: 'Isolated fixer',
    agent_type: 'subagent',
    status: 'stopped',
    parent_agent_id: primary.id,
    initial_prompt: 'Isolated git worktree subagent.',
  });
  try {
    const worktreeMeta = await provisionIsolatedSubagentWorktree(sessionRow, repo, isolatedId);
    await db('agents').where({ id: isolatedId }).update({
      worktree_path: worktreeMeta.worktree_path_stored,
      local_branch: worktreeMeta.local_branch,
    });
  } catch (err) {
    console.warn(`Dev seed: skipped isolated subagent worktree (${err?.message ?? err})`);
  }
}

async function seedSecondarySession(db, userId, repo, configs, sdk, shortId, label) {
  const entry = configs.get(sdk) ?? pickDefaultConfig(configs);
  if (!entry) return;

  const branch = repo.default_branch;
  await ensureSessionGitWorktree(repo.mainAbs, DEV_REPO_STRIPPED, shortId, branch);
  const modelParams = stringifyModelParamsForStorage(entry.env.modelParams);

  const sessionId = await insertSessionWithPrimaryBuilder(db, {
    user_id: userId,
    repo_id: repo.id,
    repo_full_name: DEV_REPO_FULL_NAME,
    base_branch: branch,
    short_id: shortId,
    label,
    initial_prompt: `Dev seed session (${sdk}).`,
    status: sdk === 'cursor' ? 'completed' : 'stopped',
    session_path: sessionWorktreeStored(DEV_REPO_STRIPPED, shortId),
    auto_push: 0,
    agent_config_id: entry.id,
    agent_sdk: sdk,
    model: entry.env.model,
    model_params: modelParams,
    last_activity_at: db.fn.now(),
  });

  await db('agents').where({ session_id: sessionId, is_primary: 1 }).update({ ref: 1 });
  const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();

  await insertExtraAgent(db, sessionId, primary, {
    ref: 2,
    name: 'Approval waiter',
    agent_type: 'subagent',
    status: 'approval',
    parent_agent_id: primary.id,
    initial_prompt: 'Subagent waiting on user approval.',
  });

  await insertExtraAgent(db, sessionId, primary, {
    ref: 3,
    name: 'Detached runner',
    agent_type: 'subagent',
    status: 'stopped',
    parent_agent_id: primary.id,
    initial_prompt: 'Stopped MCP subagent sibling.',
  });
}

/**
 * @param {import('knex').Knex} db
 * @param {{ force?: boolean, devGhKey?: string }} [opts]
 */
export async function seedDevEnvironment(db, opts = {}) {
  const { force = false, devGhKey = process.env.DEV_USER_GH_KEY?.trim() ?? '' } = opts;

  const existing = await db('users').where({ email: DEV_SEED_EMAIL }).first();
  if (existing && !force) {
    console.log('Dev user already seeded; skipping (pass force to re-seed).');
    return { skipped: true };
  }
  if (existing && force) {
    throw new Error('Re-seed with force is not implemented; remove .data or use a fresh database.');
  }

  const userId = await insertDevUser(db, devGhKey);
  const userScopedConfigs = await ensureLiveSdkAgentConfigs(db, userId);
  const defaultConfig = pickDefaultConfig(userScopedConfigs);
  if (!defaultConfig) {
    console.warn(
      'Dev seed: no SDK_TESTS_* or mock agent config available; sessions will be omitted.'
    );
  } else {
    await applyDevUserDefaults(db, userId, defaultConfig);
  }

  const repo = await ensureDevRepo(db, userId);

  if (userScopedConfigs.has('mock')) {
    await seedShowcaseSession(db, userId, repo, userScopedConfigs);
  }
  const secondarySdk = userScopedConfigs.has('cursor')
    ? 'cursor'
    : userScopedConfigs.has('claude')
      ? 'claude'
      : userScopedConfigs.has('pi')
        ? 'pi'
        : null;
  if (secondarySdk) {
    await seedSecondarySession(
      db,
      userId,
      repo,
      userScopedConfigs,
      secondarySdk,
      'devsdk2',
      `Dev hub (${secondarySdk})`
    );
  }

  console.log(`Dev seed complete (DATA_DIR=${DATA_DIR}).`);
  return { skipped: false, userId, repoId: repo.id };
}
