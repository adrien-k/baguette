import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import {
  agentHasSystemPromptMessage,
  ensureAgentSystemPromptMessage,
} from '../ensure-agent-system-prompt-message.js';

const db = createTestDb();

describe('ensure-agent-system-prompt-message', () => {
  let session;
  let agent;
  let createMock;

  beforeEach(async () => {
    await db('session_messages').delete();
    await db('agents').delete();
    await db('sessions').delete();
    await db('repos').delete();
    await db('users').delete();

    await db('users').insert({ github_id: 9, username: 'prompt', status: 'approved' });
    const user = await db('users').where({ username: 'prompt' }).first();
    await db('repos').insert({ full_name: 'o/r', repo_path: '/tmp/r' });
    const repo = await db('repos').where({ full_name: 'o/r' }).first();
    const sessionId = await insertTestSession(db, {
      user_id: user.id,
      repo_id: repo.id,
      repo_full_name: 'o/r',
      base_branch: 'main',
      short_id: 'prm01',
      initial_prompt: 'work',
      status: 'stopped',
    });
    session = await db('sessions').where({ id: sessionId }).first();
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const [childId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Helper',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: 'claude',
      model: primary.model,
      agent_config_id: primary.agent_config_id,
    });
    agent = await db('agents').where({ id: childId }).first();
    createMock = vi.fn(async (data) => {
      await db('session_messages').insert({
        session_id: data.session_id,
        agent_id: data.agent_id,
        type: data.type,
        subtype: data.subtype,
        message_json: data.message_json,
        agent_sdk: data.agent_sdk,
        model: data.model,
      });
      return data;
    });
  });

  function app() {
    return {
      get: (key) => (key === 'db' ? db : undefined),
      service: () => ({ create: createMock }),
    };
  }

  it('agentHasSystemPromptMessage detects an existing prompt row', async () => {
    expect(await agentHasSystemPromptMessage(db, session.id, agent.id)).toBe(false);
    await db('session_messages').insert({
      session_id: session.id,
      agent_id: agent.id,
      type: 'system',
      subtype: 'prompt',
      message_json: JSON.stringify({ type: 'system', subtype: 'prompt', content: 'hello' }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });
    expect(await agentHasSystemPromptMessage(db, session.id, agent.id)).toBe(true);
  });

  it('ensureAgentSystemPromptMessage persists once', async () => {
    await ensureAgentSystemPromptMessage(app(), session, agent, 'Subagent instructions');
    expect(createMock).toHaveBeenCalledTimes(1);
    const payload = createMock.mock.calls[0][0];
    expect(payload.type).toBe('system');
    expect(payload.subtype).toBe('prompt');
    expect(payload.agent_id).toBe(agent.id);
    expect(JSON.parse(payload.message_json).content).toBe('Subagent instructions');

    createMock.mockClear();
    await ensureAgentSystemPromptMessage(app(), session, agent, 'Subagent instructions');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('skips empty content', async () => {
    await ensureAgentSystemPromptMessage(app(), session, agent, '   ');
    expect(createMock).not.toHaveBeenCalled();
  });
});
