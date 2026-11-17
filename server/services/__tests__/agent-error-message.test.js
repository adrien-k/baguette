import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import {
  agentFailureError,
  hydrateAgentFailureErrors,
  lastPersistedAgentError,
  normalizeAgentErrorMessage,
  resolveFailedAgentError,
} from '../agent-error-message.js';

const db = createTestDb();

describe('agent-error-message', () => {
  let sessionId;
  let agentId;

  beforeEach(async () => {
    await db('users').insert({ github_id: 1, username: 'err', status: 'approved' });
    const user = await db('users').where({ username: 'err' }).first();
    await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
    const repo = await db('repos').where({ full_name: 'o/r' }).first();
    sessionId = await insertTestSession(db, {
      user_id: user.id,
      repo_id: repo.id,
      repo_full_name: 'o/r',
      base_branch: 'main',
      short_id: 'err01',
      initial_prompt: 'x',
      status: 'stopped',
    });
    agentId = (await db('agents').where({ session_id: sessionId, is_primary: 1 }).first()).id;
  });

  it('normalizeAgentErrorMessage trims and drops empty values', () => {
    expect(normalizeAgentErrorMessage('  boom  ')).toBe('boom');
    expect(normalizeAgentErrorMessage('   ')).toBeNull();
    expect(normalizeAgentErrorMessage(null)).toBeNull();
  });

  it('agentFailureError is only set when status is failed', () => {
    expect(agentFailureError({ status: 'failed', error_message: 'boom' })).toBe('boom');
    expect(agentFailureError({ status: 'completed', error_message: 'boom' })).toBeNull();
    expect(agentFailureError({ status: 'failed', error_message: null })).toBeNull();
  });

  it('lastPersistedAgentError reads the latest error turn_result', async () => {
    const agent = await db('agents').where({ id: agentId }).first();
    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: agentId,
      turn_id: 1,
      type: 'turn_result',
      message_json: JSON.stringify({
        type: 'turn_result',
        status: 'error',
        error_message: 'quota exceeded',
        total_cost_usd: null,
      }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });
    expect(await lastPersistedAgentError(db, agent)).toBe('quota exceeded');
  });

  it('lastPersistedAgentError can scope to a single turn', async () => {
    const agent = await db('agents').where({ id: agentId }).first();
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_id: agentId,
        turn_id: 1,
        type: 'turn_result',
        message_json: JSON.stringify({
          type: 'turn_result',
          status: 'error',
          error_message: 'first failure',
          total_cost_usd: null,
        }),
        agent_sdk: 'claude',
        model: 'sonnet',
      },
      {
        session_id: sessionId,
        agent_id: agentId,
        turn_id: 2,
        type: 'turn_result',
        message_json: JSON.stringify({
          type: 'turn_result',
          status: 'error',
          error_message: 'second failure',
          total_cost_usd: null,
        }),
        agent_sdk: 'claude',
        model: 'sonnet',
      },
    ]);
    expect(await lastPersistedAgentError(db, agent)).toBe('second failure');
    expect(await lastPersistedAgentError(db, agent, { turnId: 1 })).toBe('first failure');
    expect(await lastPersistedAgentError(db, agent, { turnId: 3 })).toBeNull();
  });

  it('lastPersistedAgentError ignores a successful turn_result', async () => {
    const agent = await db('agents').where({ id: agentId }).first();
    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: agentId,
      turn_id: 1,
      type: 'turn_result',
      message_json: JSON.stringify({
        type: 'turn_result',
        status: 'ok',
        error_message: null,
        total_cost_usd: 0,
      }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });
    expect(await lastPersistedAgentError(db, agent)).toBeNull();
  });

  it('resolveFailedAgentError prefers the explicit argument', async () => {
    const agent = await db('agents').where({ id: agentId }).first();
    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: agentId,
      turn_id: 1,
      type: 'turn_result',
      message_json: JSON.stringify({
        type: 'turn_result',
        status: 'error',
        error_message: 'from row',
        total_cost_usd: null,
      }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });
    expect(await resolveFailedAgentError(db, agent, ' from caller ')).toBe('from caller');
  });

  it('hydrateAgentFailureErrors reads turn_result only for failed agents', async () => {
    const failed = await db('agents').where({ id: agentId }).first();
    await db('agents').where({ id: agentId }).update({ status: 'failed' });
    failed.status = 'failed';
    const [otherId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Other',
      agent_type: 'builder',
      is_primary: 0,
      status: 'completed',
      agent_config_id: failed.agent_config_id,
      agent_sdk: 'claude',
      model: 'sonnet',
      model_params: null,
      current_turn_id: 0,
    });
    await db('session_messages').insert([
      {
        session_id: sessionId,
        agent_id: agentId,
        turn_id: 1,
        type: 'turn_result',
        message_json: JSON.stringify({
          type: 'turn_result',
          status: 'error',
          error_message: 'quota exceeded',
          total_cost_usd: null,
        }),
        agent_sdk: 'claude',
        model: 'sonnet',
      },
      {
        session_id: sessionId,
        agent_id: otherId,
        turn_id: 1,
        type: 'turn_result',
        message_json: JSON.stringify({
          type: 'turn_result',
          status: 'error',
          error_message: 'stale',
          total_cost_usd: null,
        }),
        agent_sdk: 'claude',
        model: 'sonnet',
      },
    ]);
    const other = await db('agents').where({ id: otherId }).first();
    await hydrateAgentFailureErrors(db, [failed, other]);
    expect(failed.error_message).toBe('quota exceeded');
    expect(other.error_message).toBeNull();
  });
});
