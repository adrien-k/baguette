import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { buildSystemPromptAppend, buildReviewSystemPromptAppend } from '../session-prompt.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { loadBaguetteInstructions } = vi.hoisted(() => ({
  loadBaguetteInstructions: vi.fn().mockResolvedValue(null),
}));

vi.mock('../baguette-config.js', () => ({
  loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  loadBaguetteInstructions,
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
  it('returns a non-empty string that points agents at CurrentSessionInfo', async () => {
    const session = await seedSession({ base_branch: 'my-feature' });
    const result = await buildSystemPromptAppend(session);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('CurrentSessionInfo');
  });

  it('includes commit/push instructions when auto_push=1', async () => {
    const session = await seedSession({ auto_push: true });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('End-of-turn shipping');
    expect(result).toContain('git add -A && git commit');
    expect(result).toContain('GitPush');
    expect(result).toContain('Wait for the commit shell command to finish');
    expect(result).toContain('sequentially');
  });

  it('always includes commit/push/PrUpsert instructions regardless of auto_push', async () => {
    const session = await seedSession({ auto_push: false });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('End-of-turn shipping');
    expect(result).toContain('git add -A && git commit');
    expect(result).toContain('GitPush');
    expect(result).toContain('PrUpsert');
    expect(result).toContain('only commit when the user asks');
  });

  it('tells agents to call ConfigRepoPrompt when .baguette.yaml is missing', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('`.baguette.yaml`');
    expect(result).toContain('ConfigRepoPrompt');
    expect(result).not.toContain('has_baguette_yaml');
    expect(result).not.toContain('baguette_config_notice');
  });

  it('appends user agent_prompt to the base prompt block', async () => {
    const session = await seedSession({ base_branch: 'main', worktree_path: '/tmp/wt' });
    session.absolute_worktree_path = '/tmp/wt';
    const result = await buildSystemPromptAppend(session, {
      agentPrompt: 'Always add unit tests.',
    });
    expect(result).toContain('Always add unit tests');
    expect(result).toContain('Additional instructions');
    expect(loadBaguetteInstructions).toHaveBeenCalledWith('/tmp/wt');
  });

  it('includes .baguette/instructions.md in additional instructions', async () => {
    loadBaguetteInstructions.mockResolvedValueOnce('Prefer pnpm.');
    const session = await seedSession({ worktree_path: '/tmp/wt' });
    const result = await buildSystemPromptAppend(session, { agentPrompt: 'Ship small PRs.' });
    expect(result).toContain('Prefer pnpm.');
    expect(result).toContain('Ship small PRs.');
  });

  it('documents .baguette scripts and instructions paths in the base prompt', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('`./.baguette/scripts/`');
    expect(result).toContain('`./.baguette/instructions.md`');
    expect(result).toContain('unless the user explicitly asks');
  });

  it('uses the light global prompt for is_global sessions', async () => {
    const session = await seedSession({
      is_global: true,
      worktree_path: 'repos',
    });
    session.absolute_worktree_path = '/data/repos';
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('global session');
    expect(result).toContain('CurrentSessionInfo');
    expect(result).toContain('CreateSession');
    expect(result).toContain('do not modify repository files on disk');
    expect(result).toContain('not available');
    expect(result).not.toContain('End-of-turn shipping');
  });
});

describe('buildReviewSystemPromptAppend', () => {
  it('tells the reviewer to open issues and reconcile resolved ones', async () => {
    const session = await seedSession({
      base_branch: 'main',
      local_branch: 'feat/review',
    });
    session.absolute_worktree_path = '/tmp/wt';
    const result = await buildReviewSystemPromptAppend(session, 'Watch for SQL injection.');
    expect(result).toContain('CurrentSessionInfo');
    expect(result).toContain('all changes in this worktree');
    expect(result).toContain('CreateIssue');
    expect(result).toContain('ListIssues');
    expect(result).toContain('CloseIssue');
    expect(result).toContain('builder agent');
    expect(result).toContain('you **must** delete');
    expect(result).toContain('Watch for SQL injection');
    expect(result).toContain('implement fixes');
    expect(result).toContain('submitted');
  });
});
