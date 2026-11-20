import { describe, it, expect, vi } from 'vitest';

const dbRef = vi.hoisted(() => ({ current: null }));

vi.mock('../../db.js', async () => {
  const { createMigratedTestDb } = await import('../../test-utils/db.js');
  const db = await createMigratedTestDb();
  dbRef.current = db;
  return { default: db };
});

import { getNavbarSystemInformation } from '../system-information.js';
import { insertSessionWithPrimaryBuilder } from '../../test-utils/session-agents.js';

describe('getNavbarSystemInformation running agent counts', () => {
  it('counts running subagents alongside the primary builder', async () => {
    const db = dbRef.current;
    const [userId] = await db('users').insert({ github_id: 1, username: 'u1', status: 'approved' });

    const sessionId = await insertSessionWithPrimaryBuilder(db, {
      user_id: userId,
      repo_full_name: 'a/b',
      base_branch: 'main',
      initial_prompt: 'test running session',
      status: 'running',
    });

    await db('agents').insert({
      session_id: sessionId,
      name: 'Helper',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'running',
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
    });

    await db('agents').insert({
      session_id: sessionId,
      name: 'Reviewer',
      agent_type: 'reviewer',
      is_primary: 0,
      status: 'running',
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
    });

    // Stopped subagent in another session must not be counted.
    const stoppedSessionId = await insertSessionWithPrimaryBuilder(db, {
      user_id: userId,
      repo_full_name: 'a/b',
      base_branch: 'main',
      initial_prompt: 'test stopped session',
      status: 'stopped',
    });
    await db('agents').insert({
      session_id: stoppedSessionId,
      name: 'Idle',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: 'claude',
      model: 'sonnet',
      current_turn_id: 0,
    });

    const info = await getNavbarSystemInformation(userId);
    expect(info.sessions.running_agents).toBe(2);
    expect(info.sessions.running_reviewers).toBe(1);
  });
});
