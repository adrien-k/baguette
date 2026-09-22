import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { buildSystemPromptAppend } from '../session-prompt.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../baguette-config.js', () => ({
  loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  interpolateEnv: vi.fn(),
  getScriptBlock: vi.fn(),
}));

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveDataDirRelativePath: vi.fn((p) => p || ''),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const db = createTestDb({ beforeEach, afterEach });

async function seedSession(fields = {}) {
  await db('users')
    .insert({ github_id: 1, username: 'alice', approved: true })
    .onConflict('github_id')
    .ignore();
  const user = await db('users').where({ username: 'alice' }).first();

  await db('repos')
    .insert({ full_name: 'test/repo', bare_path: '/tmp/repo' })
    .onConflict('full_name')
    .ignore();
  const repo = await db('repos').where({ full_name: 'test/repo' }).first();

  const [id] = await db('sessions').insert({
    user_id: user.id,
    repo_id: repo.id,
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: 'Do something',
    short_id: 'test',
    status: 'running',
    ...fields,
  });

  return db('sessions').where({ id }).first();
}

// ── buildSystemPromptAppend ───────────────────────────────────────────────────

describe('buildSystemPromptAppend', () => {
  it('returns a non-empty string containing the base_branch', async () => {
    const session = await seedSession({ base_branch: 'my-feature' });
    const result = await buildSystemPromptAppend(session);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('my-feature');
  });

  it('includes commit/push instructions when auto_push=1', async () => {
    const session = await seedSession({ auto_push: true });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('Stage and commit');
    expect(result).toContain('GitPush');
  });

  it('always includes commit/push/PrUpsert instructions regardless of auto_push', async () => {
    const session = await seedSession({ auto_push: false });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('Stage and commit');
    expect(result).toContain('GitPush');
    expect(result).toContain('PrUpsert');
  });

  it('includes baguette config notice when loadBaguetteConfig returns null', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('no .baguette.yaml config file');
  });

  it('omits baguette config notice when loadBaguetteConfig returns a config', async () => {
    const { loadBaguetteConfig } = await import('../baguette-config.js');
    loadBaguetteConfig.mockResolvedValueOnce({ webserver: { port: 3000 } });
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).not.toContain('no .baguette.yaml config file');
  });
});
