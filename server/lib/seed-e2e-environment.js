/* eslint-disable no-console -- e2e seed CLI progress */
/**
 * Minimal Playwright / e2e seed: approved `dev` user only (no repo, sessions, or skills).
 * Mock agent config and session defaults are ensured on `/auth/dev` when ENABLE_MOCK_AGENT is set.
 */
import { DEV_SEED_EMAIL, insertDevUser } from './seed-dev-environment.js';

/**
 * @param {import('knex').Knex} db
 * @param {{ devGhKey?: string }} [opts]
 */
export async function seedE2eEnvironment(db, opts = {}) {
  const devGhKey = opts.devGhKey ?? '';
  const existing = await db('users').where({ email: DEV_SEED_EMAIL }).first();
  if (existing) {
    console.log('E2e dev user already seeded; skipping.');
    return { skipped: true, userId: existing.id };
  }
  const userId = await insertDevUser(db, devGhKey);
  console.log('E2e dev user seeded.');
  return { skipped: false, userId };
}
