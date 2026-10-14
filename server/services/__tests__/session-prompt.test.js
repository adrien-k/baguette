import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import {
  buildSystemPromptAppend,
  buildReviewSystemPromptAppend,
  loadFullSubagentPromptTemplate,
} from '../session-prompt.js';

const { loadBaguetteAgentPrompt } = vi.hoisted(() => ({
  loadBaguetteAgentPrompt: vi.fn().mockResolvedValue(null),
}));

vi.mock('../baguette-config.js', () => ({
  loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  loadBaguetteAgentPrompt,
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

const db = createTestDb();

async function seedSession(fields = {}) {
  await db('users')
    .insert({ github_id: 1, username: 'alice', approved: true })
    .onConflict('github_id')
    .ignore();
  const user = await db('users').where({ username: 'alice' }).first();

  await db('repos')
    .insert({ full_name: 'test/repo', repo_path: '/tmp/repo' })
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

describe('buildSystemPromptAppend', () => {
  it('returns a non-empty string that points agents at CurrentSessionInfo', async () => {
    const session = await seedSession({ base_branch: 'my-feature' });
    const result = await buildSystemPromptAppend(session);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('CurrentSessionInfo');
  });

  it('includes commit and UpdateSession instructions when auto_push=1', async () => {
    const session = await seedSession({ auto_push: true });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('End-of-turn shipping');
    expect(result).toContain('git add -A && git commit');
    expect(result).toContain('UpdateSession');
    expect(result).toContain('after your turn ends');
    expect(result).not.toContain('GitPush');
    expect(result).not.toContain('PrUpsert');
  });

  it('includes commit/PR write-up instructions regardless of auto_push', async () => {
    const session = await seedSession({ auto_push: false });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('End-of-turn shipping');
    expect(result).toContain('git add -A && git commit');
    expect(result).toContain('UpdateSession');
    expect(result).toContain('do not skip it');
    expect(result).toContain('only commit when the user asks');
    expect(result).toContain('GitHub pull request template');
    expect(result).toContain('## Why');
    expect(result).toContain('automated tests cannot cover');
    expect(result).not.toContain('PrUpsert');
  });

  it('tells agents to call ConfigRepoPrompt when .baguette.yaml is missing', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('`.baguette.yaml`');
    expect(result).toContain('ConfigRepoPrompt');
    expect(result).not.toContain('has_baguette_yaml');
    expect(result).not.toContain('baguette_config_notice');
  });

  it('appends repo builder.md to the base prompt block', async () => {
    loadBaguetteAgentPrompt.mockResolvedValueOnce('Always add unit tests.');
    const session = await seedSession({ base_branch: 'main', session_path: '/tmp/wt' });
    session.absolute_session_path = '/tmp/wt';
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('Always add unit tests');
    expect(result).toContain('Additional instructions');
    expect(loadBaguetteAgentPrompt).toHaveBeenCalledWith('/tmp/wt', 'builder');
  });

  it('documents .baguette scripts and agents paths in the base prompt', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('`./.baguette/scripts/`');
    expect(result).toContain('./.baguette/agents/');
    expect(result).toContain('unless the user explicitly asks');
    expect(result).toContain('does **not** include the GitHub CLI (`gh`)');
  });

  it('documents Mermaid diagrams in messages and plans in the base prompt', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('Mermaid');
    expect(result).toContain('```mermaid');
    expect(result).toContain('messages');
    expect(result).toContain('plan');
  });

  it('uses builder end-of-turn shipping for extra builders', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session, {
      agent: { is_primary: 0, agent_type: 'builder' },
    });
    expect(result).toContain('End-of-turn shipping');
    expect(result).toContain('UpdateSession');
    expect(result).not.toContain('Subagent role');
  });

  it('uses subagent role prompt for subagent agents', async () => {
    const session = await seedSession({ session_path: '/tmp/wt' });
    const result = await buildSystemPromptAppend(session, { agent: { agent_type: 'subagent' } });
    expect(result).toContain('Subagent role');
    expect(result).toContain('StartSubagent');
    expect(result).not.toContain('End-of-turn shipping (required every turn)');
    expect(result).not.toContain('Baguette repo configuration');
    expect(result).toContain('do **not** have `UpdateSession`');
    expect(loadBaguetteAgentPrompt).toHaveBeenCalledWith('/tmp/wt', 'subagent');
  });

  it('loadFullSubagentPromptTemplate includes subagent role rules', async () => {
    const result = await loadFullSubagentPromptTemplate();
    expect(result).toContain('Subagent role');
    expect(result).not.toContain('End-of-turn shipping (required every turn)');
    expect(result).not.toContain('does **not** include the GitHub CLI (`gh`)');
    expect(result).not.toContain('Baguette repo configuration');
  });

  it('uses the light global prompt for is_global sessions', async () => {
    const session = await seedSession({
      is_global: true,
      session_path: 'repos',
    });
    session.absolute_session_path = '/data/repos';
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
    session.absolute_session_path = '/tmp/wt';
    const result = await buildReviewSystemPromptAppend(session, 'Watch for SQL injection.');
    expect(result).toContain('CurrentSessionInfo');
    expect(result).toContain('all changes in this worktree');
    expect(result).toContain('CreateIssue');
    expect(result).toContain('ListIssues');
    expect(result).toContain('CloseIssue');
    expect(result).toContain('builder agent');
    expect(result).toContain('you **must** close');
    expect(result).toContain('Watch for SQL injection');
    expect(result).toContain('implement fixes');
    expect(result).toContain('submitted');
  });
});
