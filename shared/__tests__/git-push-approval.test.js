import { describe, expect, it } from 'vitest';
import { gitPushRequiresApproval } from '../git-push-approval.js';

const SESSION = {
  remote_branch: 'feature/session',
  local_branch: 'feature/session-local',
  auto_push: true,
};

const FIXED = ['development'];

describe('gitPushRequiresApproval', () => {
  it('requires approval for force pushes even to fixed branches', () => {
    expect(
      gitPushRequiresApproval({
        force: 'force',
        branch: 'development',
        session: SESSION,
        agentFixedPushBranches: FIXED,
      })
    ).toBe(true);
  });

  it('skips approval for a normal push to a configured fixed branch', () => {
    expect(
      gitPushRequiresApproval({
        branch: 'development',
        session: SESSION,
        agentFixedPushBranches: FIXED,
      })
    ).toBe(false);
  });

  it('skips approval for source_branch when the target is fixed', () => {
    expect(
      gitPushRequiresApproval({
        branch: 'development',
        source_branch: 'topic/subagent',
        session: SESSION,
        agentFixedPushBranches: FIXED,
      })
    ).toBe(false);
  });

  it('requires approval when auto-push is off even for a fixed target', () => {
    expect(
      gitPushRequiresApproval({
        branch: 'development',
        session: { ...SESSION, auto_push: false },
        agentFixedPushBranches: FIXED,
      })
    ).toBe(true);
  });

  it('requires approval for non-fixed branches', () => {
    expect(gitPushRequiresApproval({ branch: 'development', session: SESSION })).toBe(true);
  });

  it('requires approval for session branch when auto-push is off', () => {
    expect(gitPushRequiresApproval({ session: { ...SESSION, auto_push: false } })).toBe(true);
  });
});
