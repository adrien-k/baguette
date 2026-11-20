import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMigratedTestDb } from '../../test-utils/db.js';
import { DEV_SEED_EMAIL, DEV_SEED_USERNAME } from '../seed-dev-environment.js';
import { seedE2eEnvironment } from '../seed-e2e-environment.js';

describe('seedE2eEnvironment', () => {
  let db;

  beforeAll(async () => {
    db = await createMigratedTestDb();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('creates only the dev user', async () => {
    const result = await seedE2eEnvironment(db, { devGhKey: '' });
    expect(result.skipped).toBe(false);

    const user = await db('users').where({ email: DEV_SEED_EMAIL }).first();
    expect(user?.username).toBe(DEV_SEED_USERNAME);
    expect(user?.onboarding_completed).toBe(1);

    const repoCount = await db('repos').count('* as c').first();
    expect(Number(repoCount?.c)).toBe(0);

    const sessionCount = await db('sessions').count('* as c').first();
    expect(Number(sessionCount?.c)).toBe(0);

    const rerun = await seedE2eEnvironment(db);
    expect(rerun.skipped).toBe(true);
  });
});
