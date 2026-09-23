import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { loadSecretsForUser } from '../session-env.js';

const db = createTestDb({ beforeEach, afterEach });

describe('loadSecretsForUser', () => {
  beforeEach(async () => {
    await db('users').insert({ github_id: 1, username: 'alice', approved: true });
  });

  it('lets personal secrets override global keys', async () => {
    await db('secrets').insert([
      { key: 'TOKEN', value: 'global', user_id: null },
      { key: 'TOKEN', value: 'personal', user_id: 1 },
      { key: 'ONLY_GLOBAL', value: 'g', user_id: null },
    ]);
    const secrets = await loadSecretsForUser(db, 1);
    expect(secrets.TOKEN).toBe('personal');
    expect(secrets.ONLY_GLOBAL).toBe('g');
  });
});
