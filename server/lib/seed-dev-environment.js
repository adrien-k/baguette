/* eslint-disable no-console -- dev seed CLI progress */
/**
 * Seed the local dev SQLite database: dev user, agent configs (from SDK_TESTS_* env),
 * a local repo, and sample sessions with varied subagents. Idempotent when the dev
 * user already exists (skipped unless `force` is set).
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import * as yaml from 'js-yaml';
import {
  DATA_DIR,
  normalizeRepoPathForStorage,
  resolveRepoPath,
  storedRepoPath,
} from '../config.js';
import { createWorktree, initLocalRepo, uniqueLocalBranch } from '../services/github.js';
import { insertTestAgentConfig } from '../test-utils/agent-configs.js';
import { readLiveSdkEnv } from '../test-utils/sdk-live-env.js';
import { insertSessionWithPrimaryBuilder } from '../test-utils/session-agents.js';
import { insertAgentObserver } from '../services/agents-db.js';
import { provisionIsolatedSubagentWorktree } from '../services/subagent-worktree.js';
import { ensureMockAgentConfig } from '../agent-sdks/mock/mock-agent-config.js';
import { isMockAgentSdkEnabled, MOCK_STANDARD_MODEL_ID } from '../../shared/mock-agent-sdk.js';
import { stringifyAgentDefaultModel } from '../../shared/agent-default-model.js';
import { stringifyModelParamsForStorage } from '../../shared/agent-session-defaults.js';
import { USER_STATUS_APPROVED } from '../../shared/user-status.js';
import { accountAgentConfigLabel } from '../../shared/agent-config-labels.js';
import { encrypt } from './encrypt.js';
import { serializeAutoLoadSkillLabels } from '../services/skill-resolution.js';

const execFileAsync = promisify(execFile);

export const DEV_SEED_EMAIL = 'dev@baguette.local';
export const DEV_SEED_USERNAME = 'dev';
export const DEV_REPO_FULL_NAME = 'local-repo-example';
export const DEV_REPO_STRIPPED = 'local-repo-example';

const LIVE_SDKS = ['claude', 'cursor', 'pi'];

export const DEV_SEED_RECIPE_PLAN_LABEL = 'Plan from template';

/** Custom chat recipes committed on `local-repo-example` for composer dropdown dogfooding. */
const DEV_SEED_RECIPES = [
  {
    label: DEV_SEED_RECIPE_PLAN_LABEL,
    description: 'Kick off a small implementation plan in this sample repo',
    prompt:
      'Draft a short plan for improving the README in this repo, then create an interactive plan for my review.',
  },
  {
    label: 'Run hello task',
    description: 'Exercise ListProjectCommands and RunTask against this repo config',
    prompt:
      'Call ListProjectCommands, then RunTask with label "hello" and detach false. Reply HELLO_OK when the task succeeds.',
  },
];

const DEV_SEED_SKILLS = [
  {
    label: 'Dev workflow notes',
    description: 'Reminders for local Baguette dogfooding',
    content: [
      '# Dev workflow notes',
      '',
      '- Prefer mock agent sessions for UI work.',
      '- Use the Recipes dropdown in the composer for one-click prompts.',
      '- Run `pnpm run fix` before committing.',
    ].join('\n'),
  },
  {
    label: 'PR hygiene',
    description: 'Lightweight checklist before opening or updating a PR',
    content: [
      '# PR hygiene',
      '',
      '1. Re-read the diff against the base branch.',
      '2. Confirm CI is green or explain failures.',
      '3. Update the PR description when scope changes.',
    ].join('\n'),
  },
];

const INTEGRATION_PRESET_DESCRIPTION = {
  claude: 'Claude (integration test)',
  cursor: 'Cursor (integration test)',
  pi: 'Pi (integration test)',
  mock: 'Mock (local dev)',
};

function modelDefaultJsonFromLiveEnv(env) {
  return stringifyAgentDefaultModel({
    model: env.model,
    model_params: env.modelParams,
  });
}

async function applyAgentConfigDefaultModel(db, configId, env) {
  const json = modelDefaultJsonFromLiveEnv(env);
  if (!json) return;
  await db('agent_configs').where({ id: configId }).update({ default_model: json });
}

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

function sessionWorktreeStored(strippedName, shortId) {
  return `repos/${strippedName}/sessions/${shortId}/worktree`;
}

/** Session worktree with a unique local branch (same pattern as session provisioning). */
async function ensureSessionGitWorktree(repo, shortId, startBranch) {
  const strippedName = repo.stripped_name ?? DEV_REPO_STRIPPED;
  const localBranch = uniqueLocalBranch(startBranch, shortId);
  const { worktreePath } = await createWorktree(
    {
      stripped_name: strippedName,
      repo_path: repo.repo_path,
      full_name: repo.full_name ?? DEV_REPO_FULL_NAME,
    },
    startBranch,
    shortId,
    '', // local repos have no origin
    { localBranch }
  );
  return {
    absolute: worktreePath,
    stored: sessionWorktreeStored(strippedName, shortId),
    localBranch,
    remoteBranch: startBranch,
  };
}

/** @returns {Promise<Map<string, { id: number, env: ReturnType<typeof readLiveSdkEnv> }>>} */
async function ensureLiveSdkAgentConfigs(db, userId) {
  const configs = new Map();
  for (const sdk of LIVE_SDKS) {
    const env = readLiveSdkEnv(sdk);
    if (!env.enabled) continue;
    const existing = await db('agent_configs')
      .where({ user_id: userId, sdk })
      .whereNull('deleted_at')
      .first();
    if (existing) {
      configs.set(sdk, { id: existing.id, env });
      continue;
    }
    const id = await insertTestAgentConfig(db, userId, {
      sdk,
      label: accountAgentConfigLabel(sdk),
      apiKey: env.apiKey,
      apiKeyEnvVar: env.apiKeyEnvVar,
      apiUrl: env.apiUrl,
    });
    await applyAgentConfigDefaultModel(db, id, env);
    configs.set(sdk, { id, env });
  }
  if (isMockAgentSdkEnabled()) {
    let mockId = (
      await db('agent_configs')
        .where({ user_id: userId, sdk: 'mock' })
        .whereNull('deleted_at')
        .first()
    )?.id;
    if (!mockId) {
      mockId = await ensureMockAgentConfig(db, userId);
    }
    if (mockId) {
      const mockEnv = {
        ...readLiveSdkEnv('mock'),
        model: MOCK_STANDARD_MODEL_ID,
        modelParams: null,
      };
      await applyAgentConfigDefaultModel(db, mockId, mockEnv);
      configs.set('mock', {
        id: mockId,
        env: mockEnv,
      });
    }
  }
  return configs;
}

async function seedIntegrationPresets(db, userId, configs) {
  for (const [sdk, entry] of configs) {
    const existing = await db('agent_model_presets')
      .where({ user_id: userId, agent_config_id: entry.id })
      .first();
    if (existing) continue;
    const description = INTEGRATION_PRESET_DESCRIPTION[sdk] ?? `${sdk} (integration test)`;
    const modelParams = stringifyModelParamsForStorage(entry.env.modelParams);
    await db('agent_model_presets').insert({
      user_id: userId,
      description,
      agent_config_id: entry.id,
      model: entry.env.model,
      model_params: modelParams,
      enabled: 1,
      for_subagents: 1,
      for_new_sessions: 1,
    });
  }
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

async function applyDevUserDefaults(db, userId, configs) {
  const mock = configs.get('mock');
  const builder = mock ?? pickDefaultConfig(configs);
  if (!builder) return;

  const defaultModelJson = modelDefaultJsonFromLiveEnv(builder.env);
  await db('users').where({ id: userId }).update({
    agent_default_config_id: builder.id,
    agent_default_model: defaultModelJson,
    reviewer_default_config_id: builder.id,
    reviewer_default_model: defaultModelJson,
    subagent_default_mode: 'preset',
    subagent_default_config_id: null,
    subagent_default_model: null,
  });
}

async function gitCommitDevRepo(cwd, message) {
  await execFileAsync('git', ['add', '-A'], { cwd, stdio: 'pipe' });
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Baguette Dev Seed',
    GIT_AUTHOR_EMAIL: 'dev-seed@baguette.local',
    GIT_COMMITTER_NAME: 'Baguette Dev Seed',
    GIT_COMMITTER_EMAIL: 'dev-seed@baguette.local',
  };
  await execFileAsync('git', ['commit', '-m', message], {
    cwd,
    stdio: 'pipe',
    env: gitEnv,
  });
}

async function seedLocalRepoExampleConfig(repo) {
  const config = {
    config: {
      recipes: DEV_SEED_RECIPES,
      tasks: {
        hello: {
          run: 'echo hello from local-repo-example',
          description: 'Smoke task for dev seed recipes',
        },
      },
    },
  };
  const text = yaml.dump(config, { lineWidth: -1 });
  const configPath = path.join(repo.mainAbs, '.baguette.yaml');
  await writeFile(configPath, text, 'utf8');
  await writeFile(
    path.join(repo.mainAbs, 'README.md'),
    '# local-repo-example\n\nSample local repository seeded for Baguette dev preview.\n',
    'utf8'
  );
  await gitCommitDevRepo(repo.mainAbs, 'dev seed: baguette config and recipes');
}

async function seedUserSkills(db, userId) {
  const now = new Date().toISOString();
  for (const skill of DEV_SEED_SKILLS) {
    const existing = await db('skills').where({ user_id: userId, label: skill.label }).first();
    if (existing) continue;
    await db('skills').insert({
      user_id: userId,
      label: skill.label,
      description: skill.description,
      content: skill.content,
      created_at: now,
      updated_at: now,
    });
  }
  const autoLoad = serializeAutoLoadSkillLabels([DEV_SEED_SKILLS[0].label]);
  await db('users').where({ id: userId }).update({ default_auto_load_skills: autoLoad });
}

async function ensureDevRepo(db, userId) {
  let repoRow = await db('repos').where({ full_name: DEV_REPO_FULL_NAME }).first();
  let repoAbs = repoRow ? resolveRepoPath(repoRow) : null;
  if (!repoAbs) {
    repoAbs = await initLocalRepo(DEV_REPO_STRIPPED);
  }
  const defaultBranch = await defaultBranchForRepo(repoAbs);
  const repoPathStored =
    repoRow?.repo_path ??
    (normalizeRepoPathForStorage(repoAbs, DEV_REPO_STRIPPED) || storedRepoPath(DEV_REPO_STRIPPED));

  if (!repoRow) {
    const [repoId] = await db('repos').insert({
      full_name: DEV_REPO_FULL_NAME,
      stripped_name: DEV_REPO_STRIPPED,
      repo_path: repoPathStored,
      default_branch: defaultBranch,
      last_fetched_at: db.fn.now(),
      origin: null,
      access_mode: 'local',
    });
    repoRow = {
      id: repoId,
      full_name: DEV_REPO_FULL_NAME,
      stripped_name: DEV_REPO_STRIPPED,
      repo_path: repoPathStored,
      default_branch: defaultBranch,
      access_mode: 'local',
      origin: null,
    };
  }

  const link = await db('user_repos').where({ user_id: userId, repo_id: repoRow.id }).first();
  if (!link) {
    await db('user_repos').insert({
      user_id: userId,
      repo_id: repoRow.id,
      show_in_all_sessions: 1,
    });
  } else if (Number(link.show_in_all_sessions) === 0) {
    await db('user_repos').where({ id: link.id }).update({ show_in_all_sessions: 1 });
  }

  return {
    id: repoRow.id,
    full_name: DEV_REPO_FULL_NAME,
    stripped_name: DEV_REPO_STRIPPED,
    repo_path: repoPathStored,
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
  const existing = await db('sessions').where({ user_id: userId, short_id: shortId }).first();
  if (existing) return;

  const branch = repo.default_branch;
  const worktree = await ensureSessionGitWorktree(repo, shortId, branch);

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
    session_path: worktree.stored,
    local_branch: worktree.localBranch,
    remote_branch: worktree.remoteBranch,
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

  const existing = await db('sessions').where({ user_id: userId, short_id: shortId }).first();
  if (existing) return;

  const branch = repo.default_branch;
  const worktree = await ensureSessionGitWorktree(repo, shortId, branch);
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
    session_path: worktree.stored,
    local_branch: worktree.localBranch,
    remote_branch: worktree.remoteBranch,
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

/** True when the dev user, sample repo, skills, configs, and showcase session are present. */
export async function isDevSeedComplete(db) {
  const user = await db('users').where({ email: DEV_SEED_EMAIL }).first();
  if (!user) return false;

  const repo = await db('repos').where({ full_name: DEV_REPO_FULL_NAME }).first();
  if (!repo) return false;

  const link = await db('user_repos').where({ user_id: user.id, repo_id: repo.id }).first();
  if (!link) return false;

  const skillCount = await db('skills').where({ user_id: user.id }).count('* as c').first();
  if (Number(skillCount?.c ?? 0) < DEV_SEED_SKILLS.length) return false;

  const configCount = await db('agent_configs')
    .where({ user_id: user.id })
    .whereNull('deleted_at')
    .count('* as c')
    .first();
  if (Number(configCount?.c ?? 0) < 1) return false;

  if (isMockAgentSdkEnabled()) {
    const hub = await db('sessions').where({ user_id: user.id, short_id: 'devhub1' }).first();
    if (!hub) return false;
  }

  return true;
}

/**
 * @param {import('knex').Knex} db
 * @param {{ force?: boolean, devGhKey?: string }} [opts]
 */
export async function seedDevEnvironment(db, opts = {}) {
  const { force = false, devGhKey = process.env.DEV_USER_GH_KEY?.trim() ?? '' } = opts;

  if (force) {
    throw new Error(
      'Re-seed with force is not supported in-process. Run `pnpm run dev-data:reset` (baguette task dev-data:reset) to wipe .data and seed again.'
    );
  }

  const existing = await db('users').where({ email: DEV_SEED_EMAIL }).first();
  if (existing && (await isDevSeedComplete(db))) {
    console.log('Dev seed already complete; skipping.');
    return { skipped: true };
  }

  let userId;
  if (existing) {
    userId = existing.id;
    if (devGhKey) {
      await db('users')
        .where({ id: userId })
        .update({ access_token_encrypted: encrypt(devGhKey) });
    }
    console.log('Resuming dev seed for existing dev user…');
  } else {
    userId = await insertDevUser(db, devGhKey);
  }
  const userScopedConfigs = await ensureLiveSdkAgentConfigs(db, userId);
  if (userScopedConfigs.size === 0) {
    console.warn(
      'Dev seed: no SDK_TESTS_* or mock agent config available; sessions will be omitted.'
    );
  } else {
    await applyDevUserDefaults(db, userId, userScopedConfigs);
    await seedIntegrationPresets(db, userId, userScopedConfigs);
  }

  const repo = await ensureDevRepo(db, userId);
  await seedLocalRepoExampleConfig(repo);
  await seedUserSkills(db, userId);

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
