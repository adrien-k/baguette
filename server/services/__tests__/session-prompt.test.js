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
    .insert({ github_id: 1, username: 'alice', status: 'approved' })
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
    expect(result).toContain('ListSkills');
    expect(result).toContain('ReadSkill');
  });

  it('includes commit and UpdateSession instructions when auto_push=1', async () => {
    const session = await seedSession({ auto_push: true });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('End-of-turn shipping');
    expect(result).toContain('CRITICAL — end-of-turn shipping');
    expect(result).toContain('git add -A && git commit');
    expect(result).toContain('UpdateSession');
    expect(result).toContain('after your turn ends');
    expect(result).not.toContain('GitPush');
    expect(result).not.toContain('PrUpsert');
    const lastShipping = result.lastIndexOf('End-of-turn shipping (required every turn)');
    const runningTests = result.lastIndexOf('## Running Tests');
    expect(lastShipping).toBeGreaterThan(runningTests);
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

  it('documents multi-plan StartPlan/CompletePlan and completed todos instead of DeleteTodo', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('**`StartPlan`**');
    expect(result).toContain('**`ListPlans`**');
    expect(result).toContain('**`CompletePlan`**');
    expect(result).toContain('current_plan_id');
    expect(result).not.toContain('once for the initial plan');
    expect(result).toContain('**Run the plan**');
    expect(result).toContain('only sends a message');
    expect(result).toContain('Mark todos **`completed`**');
    expect(result).toContain('do **not** use **`DeleteTodo`** as the normal workflow');
  });

  it('uses subagent role prompt for subagent agents', async () => {
    const session = await seedSession({ session_path: '/tmp/wt' });
    const result = await buildSystemPromptAppend(session, { agent: { agent_type: 'subagent' } });
    expect(result).toContain('Subagent role');
    expect(result).toContain('StartSubagent');
    expect(result).not.toContain('End-of-turn shipping (required every turn)');
    expect(result).not.toContain('Baguette repo configuration');
    expect(result).toContain('do **not** have `UpdateSession`');
    expect(result).toContain('StartPlan');
    expect(result).toContain('CompletePlan');
    expect(result).toContain('Mark todos **`completed`**');
    expect(result).toContain('do **not** use **`DeleteTodo`** as the normal workflow');
    expect(loadBaguetteAgentPrompt).toHaveBeenCalledWith('/tmp/wt', 'subagent');
  });

  it('loadFullSubagentPromptTemplate includes subagent role rules', async () => {
    const result = await loadFullSubagentPromptTemplate();
    expect(result).toContain('Subagent role');
    expect(result).not.toContain('End-of-turn shipping (required every turn)');
    expect(result).not.toContain('does **not** include the GitHub CLI (`gh`)');
    expect(result).not.toContain('Baguette repo configuration');
  });

  it('keeps GitHub PR instructions for github remotes', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session, {
      repo: {
        access_mode: 'github',
        origin: 'https://github.com/acme/app.git',
      },
      user: { access_token: 'tok' },
    });
    expect(result).toContain('does **not** include the GitHub CLI (`gh`)');
    expect(result).toContain('PrRead');
    expect(result).toContain('PrComments');
    expect(result).toContain('GitHub pull request template');
    expect(result).toContain('syncs the pull request to GitHub');
  });

  it('tells local repos to commit only with no push', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session, {
      repo: { access_mode: 'local', origin: null },
      user: { id: 1 },
    });
    expect(result).toContain('**local** repository');
    expect(result).toContain('does **not** push');
    expect(result).toContain('UpdateSession');
    expect(result).not.toContain('PrRead');
    expect(result).not.toContain('PrComments');
    expect(result).not.toContain('GitHub CLI');
    expect(result).not.toContain('GitHub pull request template');
  });

  it('appends the user MCP server guidance when a described server is enabled', async () => {
    const session = await seedSession({
      base_branch: 'main',
      mcp_servers: JSON.stringify({ default: true }),
    });
    const [denied] = await db('user_mcp_servers').insert({
      user_id: session.user_id,
      name: 'undocumented',
      transport: 'http',
      url: 'https://mcp.example/no',
      enabled: 1,
    });
    const [onId] = await db('user_mcp_servers').insert({
      user_id: session.user_id,
      name: 'fabricate',
      transport: 'http',
      url: 'https://mcp.example/fabricate',
      enabled: 1,
      description: 'Build realistic test fixtures when the task needs seeded data.',
    });
    const [sseId] = await db('user_mcp_servers').insert({
      user_id: session.user_id,
      name: 'events',
      transport: 'sse',
      url: 'https://mcp.example/sse',
      enabled: 1,
      description: 'Streamed in-app notifications.',
    });
    const snapshot = { default: false, [denied]: true, [onId]: true, [sseId]: true };
    await db('sessions')
      .where({ id: session.id })
      .update({ mcp_servers: JSON.stringify(snapshot) });
    const sessionRow = await db('sessions').where({ id: session.id }).first();

    const piPrompt = await buildSystemPromptAppend(sessionRow, { db, agentSdk: 'pi' });
    expect(piPrompt).toContain('## User MCP servers');
    expect(piPrompt).toContain('`fabricate`: Build realistic test fixtures');
    expect(piPrompt).toContain('mcp__fabricate__<tool>');
    expect(piPrompt).not.toContain('`events`');
    expect(piPrompt).not.toContain('`undocumented`');

    const claudePrompt = await buildSystemPromptAppend(sessionRow, { db, agentSdk: 'claude' });
    expect(claudePrompt).toContain('`events`: Streamed in-app notifications.');
  });

  it('renders no MCP section when db is missing or nothing described is enabled', async () => {
    const session = await seedSession({ base_branch: 'main' });
    const [offId] = await db('user_mcp_servers').insert({
      user_id: session.user_id,
      name: 'docs',
      transport: 'http',
      url: 'https://mcp.example/docs',
      enabled: 1,
      description: 'docs lookup',
    });
    await db('sessions')
      .where({ id: session.id })
      .update({ mcp_servers: JSON.stringify({ [offId]: false }) });
    const sessionRow = await db('sessions').where({ id: session.id }).first();
    const withDb = await buildSystemPromptAppend(sessionRow, { db, agentSdk: 'claude' });
    expect(withDb).not.toContain('## User MCP servers');
    const noDb = await buildSystemPromptAppend(sessionRow);
    expect(noDb).not.toContain('## User MCP servers');
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
    expect(result).toContain('ListSkills');
    expect(result).toContain('ReadSkill');
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
    expect(result).toContain('ListSkills');
    expect(result).toContain('ReadSkill');
  });

  it('appends MCP server guidance for the reviewer turn', async () => {
    const session = await seedSession({ base_branch: 'main' });
    const [onId] = await db('user_mcp_servers').insert({
      user_id: session.user_id,
      name: 'fabricate',
      transport: 'http',
      url: 'https://mcp.example/fabricate',
      enabled: 1,
      description: 'Build realistic test fixtures when the task needs seeded data.',
    });
    await db('sessions')
      .where({ id: session.id })
      .update({ mcp_servers: JSON.stringify({ [onId]: true }) });
    const sessionRow = await db('sessions').where({ id: session.id }).first();
    const result = await buildReviewSystemPromptAppend(sessionRow, 'Watch for SQL injection.', {
      db,
      agentSdk: 'claude',
    });
    expect(result).toContain('## User MCP servers');
    expect(result).toContain('`fabricate`');
  });
});
