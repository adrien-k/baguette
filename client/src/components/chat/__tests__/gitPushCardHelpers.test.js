import { describe, expect, it } from 'vitest';
import {
  buildGitPushApprovalRequestEvent,
  gitPushApprovalTriggers,
  gitPushNeedsApproval,
  resolveGitPushBranches,
} from '../gitPushCardHelpers.js';

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
    const autoPushTrigger = triggers.find((t) => t.key === 'auto_push_off');
    expect(autoPushTrigger.detail).toBe('Auto-push is disabled, so this push needs approval.');
  });

  it('uses neutral auto-push copy when auto-push is the only trigger', () => {
    const triggers = gitPushApprovalTriggers({
      targetBranch: SESSION.remote_branch,
      sessionRemoteBranch: SESSION.remote_branch,
      sessionLocalBranch: SESSION.local_branch,
      autoPushOff: true,
    });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].detail).toBe(
      'Session-branch pushes need your approval while auto-push is disabled.'
    );
  });

  it('prefers source_branch over local_branch for the push source ref', () => {
    const { targetBranch, localBranch } = resolveGitPushBranches(
      { source_branch: 'v1.2.0' },
      {
        local_branch: 'feature/session-local',
        target_branch: 'development',
      },
      SESSION
    );
    expect(targetBranch).toBe('development');
    expect(localBranch).toBe('v1.2.0');
  });

  it('builds push:request payload to reopen the approval modal', () => {
    const event = buildGitPushApprovalRequestEvent(
      42,
      { branch: 'development', reason: 'ship it' },
      {
        approval_requested: true,
        request_id: 'req-1',
        target_branch: 'development',
        auto_push_off: false,
      },
      SESSION
    );
    expect(event.sessionId).toBe(42);
    expect(event.branch).toBe('development');
    expect(event.agentRequest).toBe(true);
    expect(event.request_id).toBe('req-1');
    expect(event.reason).toBe('ship it');
  });

  it('matches gitPushNeedsApproval for common cases', () => {
    expect(gitPushNeedsApproval({ force: 'force' }, { ...SESSION, auto_push: true })).toBe(true);
    expect(gitPushNeedsApproval({ branch: 'development' }, SESSION)).toBe(true);
    expect(gitPushNeedsApproval({}, { ...SESSION, auto_push: false })).toBe(true);
    expect(gitPushNeedsApproval({}, SESSION)).toBe(false);
  });

  it('skips approval for configured fixed push branches', () => {
    expect(gitPushNeedsApproval({ branch: 'development' }, SESSION, ['development'])).toBe(false);
    expect(
      gitPushNeedsApproval({ branch: 'development', source_branch: 'subagent/topic' }, SESSION, [
        'development',
      ])
    ).toBe(false);
  });
});
