import { describe, expect, it } from 'vitest';
import { gitPushApprovalTriggers, gitPushNeedsApproval } from '../gitPushCardHelpers.js';

const SESSION = {
  remote_branch: 'feature/session',
  local_branch: 'feature/session-local',
  auto_push: true,
};

describe('gitPushApprovalTriggers', () => {
  it('lists force push', () => {
    const triggers = gitPushApprovalTriggers({
      forceMode: 'force',
      targetBranch: SESSION.remote_branch,
      sessionRemoteBranch: SESSION.remote_branch,
      sessionLocalBranch: SESSION.local_branch,
    });
    expect(triggers.map((t) => t.key)).toEqual(['force']);
  });

  it('lists non-session target branch', () => {
    const triggers = gitPushApprovalTriggers({
      targetBranch: 'development',
      sessionRemoteBranch: SESSION.remote_branch,
      sessionLocalBranch: SESSION.local_branch,
    });
    expect(triggers.map((t) => t.key)).toEqual(['target']);
  });

  it('lists source ref and auto-push off', () => {
    const triggers = gitPushApprovalTriggers({
      targetBranch: SESSION.remote_branch,
      sourceBranch: 'v1.0.0',
      sessionRemoteBranch: SESSION.remote_branch,
      sessionLocalBranch: SESSION.local_branch,
      autoPushOff: true,
    });
    expect(triggers.map((t) => t.key)).toEqual(['source', 'auto_push_off']);
  });

  it('matches gitPushNeedsApproval for common cases', () => {
    expect(gitPushNeedsApproval({ force: 'force' }, { ...SESSION, auto_push: true })).toBe(true);
    expect(gitPushNeedsApproval({ branch: 'development' }, SESSION)).toBe(true);
    expect(gitPushNeedsApproval({}, { ...SESSION, auto_push: false })).toBe(true);
    expect(gitPushNeedsApproval({}, SESSION)).toBe(false);
  });
});
