/* eslint-disable no-console -- e2e seed CLI progress */
/**
 * Minimal Playwright / e2e seed: `dev` (+ secondary `e2e-other`) and mock agent defaults.
 * No repos, sessions, or skills.
 */
import { ensureMockAgentConfig } from '../agent-sdks/mock/mock-agent-config.js';
import { isMockAgentSdkEnabled, MOCK_STANDARD_MODEL_ID } from '../../shared/mock-agent-sdk.js';
import { stringifyAgentDefaultModel } from '../../shared/agent-default-model.js';
import { USER_STATUS_APPROVED } from '../../shared/user-status.js';
import { DEV_SEED_EMAIL, insertDevUser } from './seed-dev-environment.js';

/** Second dev account for multi-user e2e (shared sessions, usage group-by). */
export const E2E_OTHER_SEED_USERNAME = 'e2e-other';
export const E2E_OTHER_SEED_EMAIL = 'e2e-other@baguette.local';
/** Matches `devLoginIdentity('e2e-other').github_id` in auth routes. */
export const E2E_OTHER_GITHUB_ID = 1_609_803_931;

async function seedE2eMockAgentDefaults(db, userId) {
  if (!isMockAgentSdkEnabled()) return null;
  const mockConfigId = await ensureMockAgentConfig(db, userId);
  if (!mockConfigId) return null;

  const defaultModelJson = stringifyAgentDefaultModel({
    model: MOCK_STANDARD_MODEL_ID,
    model_params: null,
  });
  if (defaultModelJson) {
    await db('agent_configs')
      .where({ id: mockConfigId })
      .update({ default_model: defaultModelJson });
  }

  await db('users').where({ id: userId }).update({
    agent_default_config_id: mockConfigId,
    agent_default_model: defaultModelJson,
    reviewer_default_config_id: mockConfigId,
    reviewer_default_model: defaultModelJson,
  });
  return mockConfigId;
}

async function insertE2eOtherUser(db) {
  const existing = await db('users').where({ username: E2E_OTHER_SEED_USERNAME }).first();
  if (existing) return existing.id;

  const [userId] = await db('users').insert({
    github_id: E2E_OTHER_GITHUB_ID,
    username: E2E_OTHER_SEED_USERNAME,
    email: E2E_OTHER_SEED_EMAIL,
    access_token_encrypted: null,
    status: USER_STATUS_APPROVED,
    admin: 0,
    onboarding_completed: 1,
  });
  return userId;
}

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
  await seedE2eMockAgentDefaults(db, userId);
  await insertE2eOtherUser(db);
  console.log('E2e dev user seeded (mock config + e2e-other when enabled).');
  return { skipped: false, userId };
}
