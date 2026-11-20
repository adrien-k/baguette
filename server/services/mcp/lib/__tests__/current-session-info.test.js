import { describe, it, expect, vi } from 'vitest';
import { createCurrentSessionInfoTool } from '../current-session-info.js';

vi.mock('../../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveDataDirRelativePath: vi.fn((p) => p || ''),
  };
});

const SESSION_ROW = {
  id: 1,
  label: 'Feature',
  pr_description: 'Body',
  repo_full_name: 'owner/repo',
  base_branch: 'main',
  remote_branch: 'feat/pr',
  local_branch: 'feat/pr-local',
  session_path: '/tmp/parent-wt',
  absolute_session_path: '/tmp/parent-wt',
};

describe('CurrentSessionInfo (isolated subagent)', () => {
  it('keeps parent session paths and adds subagent fields for isolated callers', async () => {
    const tool = createCurrentSessionInfoTool(async () => SESSION_ROW, {
      getCallerAgent: async () => ({
        agent_type: 'subagent',
        worktree_path: '/tmp/sub-wt',
        local_branch: 'baguette/subagent/7',
      }),
    });
    const parsed = JSON.parse((await tool.handler()).content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.session_path).toBe('/tmp/parent-wt');
    expect(parsed.local_branch).toBe('feat/pr-local');
    expect(parsed.remote_branch).toBe('feat/pr');
    expect(parsed.subagent_worktree_path).toBe('/tmp/sub-wt');
    expect(parsed.subagent_local_branch).toBe('baguette/subagent/7');
    expect(parsed.working_directory_restrictions).toContain('subagent_worktree_path');
    expect(parsed.working_directory_restrictions).not.toContain("session's session_path");
  });

  it('omits subagent fields and uses session_path restrictions for shared subagents', async () => {
    const tool = createCurrentSessionInfoTool(async () => SESSION_ROW, {
      getCallerAgent: async () => ({ agent_type: 'subagent', worktree_path: null }),
    });
    const parsed = JSON.parse((await tool.handler()).content[0].text);
    expect(parsed.subagent_worktree_path).toBeUndefined();
    expect(parsed.subagent_local_branch).toBeUndefined();
    expect(parsed.working_directory_restrictions).toContain("session's session_path");
  });
});
