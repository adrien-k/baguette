import { describe, it, expect } from 'vitest';
import {
  activeAgentsRunningLabel,
  applyAgentPatchToSession,
  agentAccessibleTitle,
  agentDisplayTitle,
  agentMenuOptionLabel,
  agentNameMatchesType,
  agentSwitcherDropdownSections,
  countActiveAgentsForSession,
  isAgentAwaitingUser,
  isAgentTurnActive,
  isAnyAgentAwaitingUser,
  isPrimaryAgent,
  isRenamableBuilder,
  isReviewerAgent,
  isSecondaryBuilder,
  isSubagentBuilder,
  mergeAgentServicePatch,
  mergeAgentsWithSessionEmbeds,
  showSessionChatFooterExtrasForAgent,
  otherAgentsRunningLabel,
  partitionSessionAgentsByRunning,
  sortSessionAgentsByLastActivityDesc,
  sortSessionAgentsByRefAsc,
} from '../sessionAgents.js';

describe('agent display labels', () => {
  it('treats default names as matching agent type', () => {
    expect(agentNameMatchesType('Builder', 'builder')).toBe(true);
    expect(agentNameMatchesType('builder', 'builder')).toBe(true);
    expect(agentNameMatchesType('Reviewer', 'reviewer')).toBe(true);
    expect(agentNameMatchesType('Code review bot', 'reviewer')).toBe(false);
  });

  it('shows only the type label when name matches type', () => {
    const agent = { name: 'Builder', agent_type: 'builder' };
    expect(agentDisplayTitle(agent)).toBe('Builder');
    expect(agentMenuOptionLabel(agent)).toBe('Builder');
  });

  it('shows custom name and badge when name differs from type', () => {
    const agent = { name: 'Ship it', agent_type: 'builder' };
    expect(agentDisplayTitle(agent)).toBe('Ship it');
    expect(agentMenuOptionLabel(agent)).toBe('Ship it (Builder)');
  });

  it('detects primary agent', () => {
    expect(isPrimaryAgent({ is_primary: 1 })).toBe(true);
    expect(isPrimaryAgent({ is_primary: 0 })).toBe(false);
    expect(isPrimaryAgent({ is_primary: true })).toBe(true);
  });

  it('sorts agents by ref ascending', () => {
    const agents = [
      { id: 10, ref: 3 },
      { id: 5, ref: 1 },
      { id: 7, ref: 2 },
    ];
    expect(sortSessionAgentsByRefAsc(agents).map((a) => a.ref)).toEqual([1, 2, 3]);
  });

  it('sorts agents by last activity, most recent first', () => {
    const agents = [
      { id: 1, updated_at: '2024-01-01T10:00:00Z' },
      { id: 2, updated_at: '2024-01-01T12:00:00Z' },
      { id: 3 },
    ];
    expect(sortSessionAgentsByLastActivityDesc(agents).map((a) => a.id)).toEqual([2, 1, 3]);
  });

  it('treats SQLite CURRENT_TIMESTAMP values as UTC', () => {
    const agents = [
      { id: 1, updated_at: '2024-01-01 12:00:01' },
      { id: 2, updated_at: '2024-01-01T12:00:00Z' },
    ];
    expect(sortSessionAgentsByLastActivityDesc(agents).map((a) => a.id)).toEqual([1, 2]);
  });

  it('prefixes menu label with session ref when present', () => {
    const agent = { ref: 3, name: 'Builder', agent_type: 'builder' };
    expect(agentMenuOptionLabel(agent)).toBe('#3 Builder');
    expect(agentAccessibleTitle(agent)).toBe('#3 Builder');
  });

  it('agentAccessibleTitle omits ref prefix when ref is missing', () => {
    const agent = { name: 'E2E MCP subagent', agent_type: 'subagent' };
    expect(agentAccessibleTitle(agent)).toBe('E2E MCP subagent');
  });
});

describe('agent turn status helpers', () => {
  it('treats only running as an active turn', () => {
    expect(isAgentTurnActive('running')).toBe(true);
    expect(isAgentTurnActive('approval')).toBe(false);
    expect(isAgentAwaitingUser('approval')).toBe(true);
  });
});

describe('mergeAgentsWithSessionEmbeds', () => {
  it('overlays stopped status when the session embed is newer', () => {
    const agents = [
      {
        id: 5,
        ref: 1,
        status: 'running',
        model: 'gpt-5',
        updated_at: '2026-11-20 08:00:00',
      },
    ];
    const embedded = [{ id: 5, ref: 1, status: 'stopped', updated_at: '2026-11-20 08:00:05' }];
    const merged = mergeAgentsWithSessionEmbeds(agents, embedded);
    expect(merged[0].status).toBe('stopped');
    expect(merged[0].model).toBe('gpt-5');
  });

  it('keeps agents-service status when the session embed is older', () => {
    const agents = [
      {
        id: 5,
        status: 'stopped',
        updated_at: '2026-11-20 08:00:10',
      },
    ];
    const embedded = [{ id: 5, status: 'running', updated_at: '2026-11-20 08:00:00' }];
    expect(mergeAgentsWithSessionEmbeds(agents, embedded)[0].status).toBe('stopped');
  });

  it('returns the same array reference when nothing changes', () => {
    const agents = [{ id: 5, status: 'stopped', updated_at: '2026-11-20 08:00:10' }];
    const embedded = [{ id: 5, status: 'stopped', updated_at: '2026-11-20 08:00:05' }];
    expect(mergeAgentsWithSessionEmbeds(agents, embedded)).toBe(agents);
  });
});

describe('mergeAgentServicePatch', () => {
  it('merges defined patch fields only', () => {
    const existing = { id: 1, status: 'running', name: 'Builder' };
    const patch = { id: 1, session_id: 9, status: 'stopped', error_message: undefined };
    expect(mergeAgentServicePatch(existing, patch)).toEqual({
      id: 1,
      status: 'stopped',
      name: 'Builder',
    });
  });
});

describe('countActiveAgentsForSession', () => {
  it('counts only running agents', () => {
    const session = {
      agents: [
        { id: 1, status: 'running' },
        { id: 2, status: 'idle' },
        { id: 3, status: 'approval' },
        { id: 4, status: 'running' },
      ],
    };
    expect(countActiveAgentsForSession(session)).toBe(2);
  });

  it('detects awaiting-user agents separately', () => {
    const session = {
      agents: [{ id: 1, status: 'approval' }],
      status: 'stopped',
    };
    expect(countActiveAgentsForSession(session)).toBe(0);
    expect(isAnyAgentAwaitingUser(session)).toBe(true);
  });

  it('returns 0 for archived sessions', () => {
    expect(
      countActiveAgentsForSession({
        archived_at: '2026-01-01',
        agents: [{ id: 1, status: 'running' }],
      })
    ).toBe(0);
  });

  it('formats running label', () => {
    expect(activeAgentsRunningLabel(1)).toBe('1 agent running');
    expect(activeAgentsRunningLabel(3)).toBe('3 agents running');
  });
});

describe('partitionSessionAgentsByRunning', () => {
  it('splits running from other statuses', () => {
    const agents = [
      { id: 1, status: 'idle' },
      { id: 2, status: 'running' },
      { id: 3, status: 'approval' },
      { id: 4, status: 'running' },
    ];
    expect(partitionSessionAgentsByRunning(agents)).toEqual({
      running: [
        { id: 2, status: 'running' },
        { id: 4, status: 'running' },
      ],
      other: [
        { id: 1, status: 'idle' },
        { id: 3, status: 'approval' },
      ],
    });
  });
});

describe('agentSwitcherDropdownSections', () => {
  it('returns null when all agents share the same running state', () => {
    const idleOnly = [{ id: 1, status: 'idle' }];
    expect(agentSwitcherDropdownSections(idleOnly, (a) => a.id)).toBeNull();
    const runningOnly = [{ id: 1, status: 'running' }];
    expect(agentSwitcherDropdownSections(runningOnly, (a) => a.id)).toBeNull();
  });

  it('returns Running and Idle sections when both are present', () => {
    const agents = [
      { id: 1, status: 'running', name: 'A' },
      { id: 2, status: 'idle', name: 'B' },
    ];
    expect(agentSwitcherDropdownSections(agents, (a) => a.name)).toEqual([
      { heading: 'Running', options: ['A'] },
      { heading: 'Idle', options: ['B'] },
    ]);
  });
});

describe('isSubagentBuilder', () => {
  it('is true only for MCP read-only non-primary builders', () => {
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 1 })).toBe(false);
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 0 })).toBe(false);
    expect(isSubagentBuilder({ agent_type: 'subagent', is_primary: 0 })).toBe(true);
    expect(isSubagentBuilder({ agent_type: 'reviewer', is_primary: 0 })).toBe(false);
  });
});

describe('isRenamableBuilder', () => {
  it('is true for primary and secondary builders only', () => {
    expect(isRenamableBuilder({ agent_type: 'builder', is_primary: 1 })).toBe(true);
    expect(isRenamableBuilder({ agent_type: 'builder', is_primary: 0 })).toBe(true);
    expect(isRenamableBuilder({ agent_type: 'subagent', is_primary: 0 })).toBe(false);
    expect(isRenamableBuilder({ agent_type: 'reviewer', is_primary: 0 })).toBe(false);
  });
});

describe('isSecondaryBuilder', () => {
  it('is true only for extra composer builders', () => {
    expect(isSecondaryBuilder({ agent_type: 'builder', is_primary: 1 })).toBe(false);
    expect(isSecondaryBuilder({ agent_type: 'builder', is_primary: 0 })).toBe(true);
    expect(isSecondaryBuilder({ agent_type: 'subagent', is_primary: 0 })).toBe(false);
    expect(isSecondaryBuilder({ agent_type: 'reviewer', is_primary: 0 })).toBe(false);
    expect(isSecondaryBuilder(null)).toBe(false);
  });
});

describe('showSessionChatFooterExtrasForAgent', () => {
  it('shows for primary and secondary builders only', () => {
    expect(showSessionChatFooterExtrasForAgent(null)).toBe(true);
    expect(showSessionChatFooterExtrasForAgent({ agent_type: 'builder', is_primary: 1 })).toBe(
      true
    );
    expect(showSessionChatFooterExtrasForAgent({ agent_type: 'builder', is_primary: 0 })).toBe(
      true
    );
    expect(showSessionChatFooterExtrasForAgent({ agent_type: 'subagent', is_primary: 0 })).toBe(
      false
    );
    expect(showSessionChatFooterExtrasForAgent({ agent_type: 'reviewer', is_primary: 0 })).toBe(
      false
    );
  });
});

describe('otherAgentsRunningLabel', () => {
  it('pluralizes the other-agents label', () => {
    expect(otherAgentsRunningLabel(1)).toBe('1 other agent running');
    expect(otherAgentsRunningLabel(3)).toBe('3 other agents running');
  });
});

describe('isReviewerAgent', () => {
  it('is true only for reviewer rows', () => {
    expect(isReviewerAgent({ agent_type: 'reviewer' })).toBe(true);
    expect(isReviewerAgent({ agent_type: 'builder' })).toBe(false);
    expect(isReviewerAgent(null)).toBe(false);
  });
});

describe('applyAgentPatchToSession', () => {
  const session = {
    id: 7,
    review_status: null,
    agents: [
      {
        id: 1,
        ref: 1,
        name: 'Builder',
        agent_type: 'builder',
        status: 'stopped',
        is_primary: 1,
        agent_config_id: 4,
        agent_sdk: 'mock',
        model: 'mock-5',
        parent_agent_id: null,
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  };

  it('merges patch fields into the embedded summary', () => {
    const next = applyAgentPatchToSession(session, {
      id: 1,
      session_id: 7,
      status: 'running',
      updated_at: '2026-01-02T00:00:00Z',
    });
    expect(next.agents[0]).toEqual(
      expect.objectContaining({
        status: 'running',
        agent_config_id: 4,
        agent_sdk: 'mock',
        model: 'mock-5',
        parent_agent_id: null,
        updated_at: '2026-01-02T00:00:00Z',
      })
    );
  });

  it('appends a new agent with tree fields to the embedded list', () => {
    const next = applyAgentPatchToSession(session, {
      id: 2,
      session_id: 7,
      ref: 2,
      name: 'worker',
      agent_type: 'subagent',
      status: 'running',
      is_primary: 0,
      agent_config_id: 5,
      agent_sdk: 'pi',
      model: 'glm-5.3',
      parent_agent_id: 1,
      updated_at: '2026-01-02T00:00:00Z',
    });
    expect(next.agents).toHaveLength(2);
    expect(next.agents[1]).toEqual(
      expect.objectContaining({
        id: 2,
        agent_sdk: 'pi',
        model: 'glm-5.3',
        parent_agent_id: 1,
      })
    );
  });

  it('ignores patches for other sessions', () => {
    const next = applyAgentPatchToSession(session, { id: 1, session_id: 99, status: 'running' });
    expect(next).toBe(session);
  });
});
