import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DATA_DIR } from '../../config.js';
import { createMigratedTestDb } from '../../test-utils/db.js';
import {
  DEV_REPO_FULL_NAME,
  DEV_REPO_STRIPPED,
  DEV_SEED_EMAIL,
  seedDevEnvironment,
} from '../seed-dev-environment.js';
import { MOCK_STANDARD_MODEL_ID } from '../../../shared/mock-agent-sdk.js';
import { parseAgentDefaultModelJson } from '../../../shared/agent-default-model.js';

describe('seedDevEnvironment', () => {
  let db;

  beforeAll(async () => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
    vi.stubEnv('SDK_TESTS_MOCK', '1');
    await fs.rm(path.join(DATA_DIR, 'repos', DEV_REPO_STRIPPED), {
      recursive: true,
      force: true,
    });
    db = await createMigratedTestDb();
  });

  afterAll(async () => {
    await db?.destroy();
    vi.unstubAllEnvs();
  });

  it('creates dev user, mock agent config, local repo, and subagent-rich sessions', async () => {
    const result = await seedDevEnvironment(db, { devGhKey: '' });
    expect(result.skipped).toBe(false);

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

    const sessions = await db('sessions').where({ user_id: user.id }).orderBy('id', 'asc');
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const hub = sessions.find((s) => s.short_id === 'devhub1');
    expect(hub?.session_path).toContain('devhub1');
    const primary = await db('agents').where({ session_id: hub.id, is_primary: 1 }).first();
    expect(primary?.model).toBe(MOCK_STANDARD_MODEL_ID);

    const agents = await db('agents').where({ session_id: hub.id }).orderBy('ref', 'asc');
    const types = agents.map((a) => a.agent_type);
    expect(types).toContain('builder');
    expect(types).toContain('reviewer');
    expect(types.filter((t) => t === 'subagent').length).toBeGreaterThanOrEqual(4);

    const rerun = await seedDevEnvironment(db);
    expect(rerun.skipped).toBe(true);
  });
});
