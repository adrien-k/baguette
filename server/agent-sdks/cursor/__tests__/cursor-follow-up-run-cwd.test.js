import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '@cursor/sdk';

import { CursorAgentService } from '../agent-service.ts';
import { agentWorktreeCwd } from '../../../services/subagent-worktree.js';
import { resolveDataDirRelativePath } from '../../../config.js';

describe('CursorAgentService._findFollowUpRun cwd', () => {
  const session = { id: 1, session_path: 'sessions/parent/worktree' };
  const sdkAgent = { agentId: 'cursor-agent-1' };
  const mockStore = {};

  let service;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new CursorAgentService();
    vi.spyOn(service, 'openSessionStore').mockResolvedValue(mockStore);
  });

  function expectedListCwd(baguetteAgent) {
    return (
      agentWorktreeCwd(session, baguetteAgent) ||
      resolveDataDirRelativePath(session.session_path) ||
      ''
    );
  }

  it('lists follow-up runs with the isolated sub-worktree cwd', async () => {
    const baguetteAgent = { id: 9, worktree_path: 'sessions/parent/sub-worktrees/9' };
    const followUp = { id: 'run-follow', status: 'running' };
    const listRuns = vi.spyOn(Agent, 'listRuns').mockResolvedValue({ items: [followUp] });

    const result = await service._findFollowUpRun(session, sdkAgent, 'run-primary', baguetteAgent);

    expect(listRuns).toHaveBeenCalledWith('cursor-agent-1', {
      cwd: expectedListCwd(baguetteAgent),
      store: mockStore,
    });
    expect(result).toBe(followUp);
  });

  it('lists follow-up runs with the session worktree when cwd is shared', async () => {
    const baguetteAgent = { id: 1, worktree_path: null };
    const followUp = { id: 'run-follow', status: 'running' };
    const listRuns = vi.spyOn(Agent, 'listRuns').mockResolvedValue({ items: [followUp] });

    const result = await service._findFollowUpRun(session, sdkAgent, 'run-primary', baguetteAgent);

    expect(listRuns).toHaveBeenCalledWith('cursor-agent-1', {
      cwd: expectedListCwd(baguetteAgent),
      store: mockStore,
    });
    expect(expectedListCwd(baguetteAgent)).toBe(resolveDataDirRelativePath(session.session_path));
    expect(result).toBe(followUp);
  });
});
