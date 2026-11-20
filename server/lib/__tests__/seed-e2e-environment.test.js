import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createMigratedTestDb } from '../../test-utils/db.js';
import { DEV_SEED_EMAIL, DEV_SEED_USERNAME } from '../seed-dev-environment.js';
import {
  E2E_OTHER_SEED_EMAIL,
  E2E_OTHER_SEED_USERNAME,
  seedE2eEnvironment,
} from '../seed-e2e-environment.js';
import { MOCK_STANDARD_MODEL_ID } from '../../../shared/mock-agent-sdk.js';

describe('seedE2eEnvironment', () => {
  let db;

  beforeAll(async () => {
    db = await createMigratedTestDb();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('creates dev users and mock agent defaults', async () => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');

    const result = await seedE2eEnvironment(db, { devGhKey: '' });
    expect(result.skipped).toBe(false);

    const user = await db('users').where({ email: DEV_SEED_EMAIL }).first();
    expect(user?.username).toBe(DEV_SEED_USERNAME);
    expect(user?.onboarding_completed).toBe(1);
    expect(user?.agent_default_config_id).toBeTruthy();

    const mockConfig = await db('agent_configs')
      .where({ user_id: user.id, sdk: 'mock' })
      .whereNull('deleted_at')
      .first();
    expect(mockConfig?.id).toBe(user.agent_default_config_id);
    expect(mockConfig?.default_model).toContain(MOCK_STANDARD_MODEL_ID);

    const other = await db('users').where({ email: E2E_OTHER_SEED_EMAIL }).first();
    expect(other?.username).toBe(E2E_OTHER_SEED_USERNAME);

    const repoCount = await db('repos').count('* as c').first();
    expect(Number(repoCount?.c)).toBe(0);

    const sessionCount = await db('sessions').count('* as c').first();
    expect(Number(sessionCount?.c)).toBe(0);

    const rerun = await seedE2eEnvironment(db);
    expect(rerun.skipped).toBe(true);

    vi.unstubAllEnvs();
  });
});
