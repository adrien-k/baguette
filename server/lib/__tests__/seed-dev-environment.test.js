/**
 * Dev seed integration test — uses an isolated DATA_DIR so vitest never rm -rf's
 * the developer's .data/repos/local-repo-example.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const { TEST_DATA_DIR } = vi.hoisted(() => ({
  TEST_DATA_DIR: `/tmp/baguette-seed-dev-env-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DATA_DIR: TEST_DATA_DIR,
    REPOS_DIR: path.join(TEST_DATA_DIR, 'repos'),
    resolveDataDirRelativePath: (subpath) => {
      if (subpath == null || subpath === '') return subpath;
      if (path.isAbsolute(subpath)) return subpath;
      return path.join(TEST_DATA_DIR, subpath);
    },
    resolveRepoPath: (repo) => {
      if (!repo) return undefined;
      const stored = repo.repo_path;
      if (stored == null || stored === '') {
        return repo.stripped_name
          ? path.join(TEST_DATA_DIR, 'repos', repo.stripped_name, 'main')
          : undefined;
      }
      if (path.isAbsolute(stored)) return stored;
      return path.join(TEST_DATA_DIR, stored);
    },
  };
});

import { createMigratedTestDb } from '../../test-utils/db.js';
import {
  DEV_REPO_FULL_NAME,
  DEV_REPO_STRIPPED,
  DEV_SEED_EMAIL,
  DEV_SEED_RECIPE_PLAN_LABEL,
  DEV_SEED_USERNAME,
  isDevSeedComplete,
  seedDevEnvironment,
} from '../seed-dev-environment.js';
import { parseAutoLoadSkillLabels } from '../../services/skill-resolution.js';
import { MOCK_STANDARD_MODEL_ID } from '../../../shared/mock-agent-sdk.js';
import { parseAgentDefaultModelJson } from '../../../shared/agent-default-model.js';
import { USER_STATUS_APPROVED } from '../../../shared/user-status.js';

describe('seedDevEnvironment', () => {
  let db;

  beforeAll(async () => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
    vi.stubEnv('SDK_TESTS_MOCK', '1');
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    await fs.rm(path.join(TEST_DATA_DIR, 'repos', DEV_REPO_STRIPPED), {
      recursive: true,
      force: true,
    });
    db = await createMigratedTestDb();
  });

  afterAll(async () => {
    await db?.destroy();
    vi.unstubAllEnvs();
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('resumes when dev user exists but seed is incomplete', async () => {
    await db('users').insert({
      github_id: 42,
      username: DEV_SEED_USERNAME,
      email: DEV_SEED_EMAIL,
      status: USER_STATUS_APPROVED,
      admin: 1,
      onboarding_completed: 1,
      subagent_default_mode: 'preset',
    });
    expect(await isDevSeedComplete(db)).toBe(false);

    const result = await seedDevEnvironment(db, { devGhKey: '' });
    expect(result.skipped).toBe(false);
    expect(await isDevSeedComplete(db)).toBe(true);

    const user = await db('users').where({ email: DEV_SEED_EMAIL }).first();
    expect(user?.username).toBe('dev');
    expect(user?.onboarding_completed).toBe(1);
    expect(user?.agent_default_config_id).toBeTruthy();

    const configs = await db('agent_configs').where({ user_id: user.id }).whereNull('deleted_at');
    const mockConfig = configs.find((c) => c.sdk === 'mock');
    expect(mockConfig).toBeTruthy();
    expect(parseAgentDefaultModelJson(mockConfig.default_model).model).toBe(MOCK_STANDARD_MODEL_ID);

    const presets = await db('agent_model_presets').where({ user_id: user.id });
    expect(presets.length).toBeGreaterThanOrEqual(1);
    expect(presets.some((p) => p.model === MOCK_STANDARD_MODEL_ID)).toBe(true);

    const repo = await db('repos').where({ full_name: DEV_REPO_FULL_NAME }).first();
    expect(repo?.access_mode).toBe('local');
    const baguetteYaml = await fs.readFile(
      path.join(TEST_DATA_DIR, repo.repo_path, '.baguette.yaml'),
      'utf8'
    );
    expect(baguetteYaml).toContain(DEV_SEED_RECIPE_PLAN_LABEL);

    const skills = await db('skills').where({ user_id: user.id });
    expect(skills.length).toBeGreaterThanOrEqual(2);
    expect(parseAutoLoadSkillLabels(user.default_auto_load_skills)).toContain('Dev workflow notes');

    const userRepo = await db('user_repos').where({ user_id: user.id, repo_id: repo.id }).first();
    expect(Number(userRepo?.show_in_all_sessions)).toBe(1);

    const sessions = await db('sessions').where({ user_id: user.id }).orderBy('id', 'asc');
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const hub = sessions.find((s) => s.short_id === 'devhub1');
    expect(hub?.session_path).toContain('devhub1');
    expect(hub?.local_branch).toBeTruthy();
    expect(hub?.remote_branch).toBeTruthy();
    expect(hub.local_branch).toContain('devhub1');
    const primary = await db('agents').where({ session_id: hub.id, is_primary: 1 }).first();
    expect(primary?.model).toBe(MOCK_STANDARD_MODEL_ID);

    const agents = await db('agents').where({ session_id: hub.id }).orderBy('ref', 'asc');
    const types = agents.map((a) => a.agent_type);
    expect(types).toContain('builder');
    expect(types).toContain('reviewer');
    expect(types.filter((t) => t === 'subagent').length).toBeGreaterThanOrEqual(4);
  });

  it('skips when dev seed is already complete', async () => {
    const rerun = await seedDevEnvironment(db);
    expect(rerun.skipped).toBe(true);
  });
});
