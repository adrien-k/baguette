/**
 * `notify_parent` subagents post their result back to the parent when their turn ends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { useClaudeAgentStub } from '../../test-utils/agent-sdks.js';
import { setAgentTurnTerminal } from '../agent-turn-patch.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb();

function makeApp(dbRef, { handleMessageCreated } = {}) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerAgentsService(app);
  useClaudeAgentStub(
    app,
    { handleMessageCreated: handleMessageCreated ?? vi.fn().mockResolvedValue(undefined) },
    ['handleMessageCreated']
  );
  registerQueuedMessagesService(app);
  registerMessagesService(app);
  return app;
}

let app;
let userId;
let sessionId;
let primaryId;
let handleMessageCreated;

async function insertSubagent(fields) {
  const primary = await db('agents').where({ id: primaryId }).first();
  const [id] = await db('agents').insert({
    session_id: sessionId,
    ref: fields.ref ?? 2,
    name: fields.name ?? 'Helper',
    agent_type: 'subagent',
    is_primary: 0,
    status: fields.status ?? 'running',
    agent_config_id: primary.agent_config_id,
    agent_sdk: 'claude',
    model: 'sonnet',
    current_turn_id: 0,
    parent_agent_id: fields.parent_agent_id ?? primaryId,
    notify_parent: fields.notify_parent ? 1 : 0,
  });
  return id;
}

const agentRow = async (id) => db('agents').where({ id }).first();

beforeEach(async () => {
  handleMessageCreated = vi.fn().mockResolvedValue(undefined);
  await db('users').insert({ github_id: 701, username: 'hold-tester', status: 'approved' });
  const user = await db('users').where({ username: 'hold-tester' }).first();
  userId = user.id;

  await db('repos').insert({ full_name: 'test/hold-repo', repo_path: '/tmp/hold-repo' });
  const repo = await db('repos').where({ full_name: 'test/hold-repo' }).first();

  sessionId = await insertTestSession(db, {
    user_id: userId,
    repo_id: repo.id,
    repo_full_name: 'test/hold-repo',
    base_branch: 'main',
    short_id: 'hold01',
    initial_prompt: 'Hold test',
    status: 'stopped',
  });
  primaryId = await db('agents')
    .where({ session_id: sessionId, is_primary: 1 })
    .first()
    .then((r) => r.id);
  await db('agents').where({ id: primaryId }).update({ status: 'running', current_turn_id: 1 });

  app = makeApp(db, { handleMessageCreated });
  await app.setup();
});

describe('notify_parent subagents', () => {
  it('posts a wake message with the result when the subagent completes', async () => {
    const childId = await insertSubagent({ ref: 2, notify_parent: true });
    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: childId,
      turn_id: 1,
      type: 'assistant',
      message_json: JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'All done, tests pass.' }] },
      }),
      agent_sdk: 'claude',
      model: 'sonnet',
    });

    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');

    expect((await agentRow(primaryId)).status).toBe('running');

    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0].message_json);
    expect(rows[0].agent_id).toBe(primaryId);
    expect(payload.title).toBe('Subagent Helper finished');
    expect(payload.content).toContain('finished with status completed');
    expect(payload.content).toContain('All done, tests pass.');
    expect(handleMessageCreated).toHaveBeenCalledTimes(1);
  });

  it('notifies the parent when the subagent turn failed', async () => {
    const childId = await insertSubagent({ ref: 3, name: 'Flaky', notify_parent: true });
    await setAgentTurnTerminal(app, { id: childId }, userId, 'failed');

    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].message_json).content).toContain(
      'Subagent #3 "Flaky" finished with status failed'
    );
  });

  it('does not notify when notify_parent is not set', async () => {
    const childId = await insertSubagent({ ref: 4 });
    await setAgentTurnTerminal(app, { id: childId }, userId, 'completed');
    const rows = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(rows).toHaveLength(0);
    expect(handleMessageCreated).not.toHaveBeenCalled();
  });

  it('completes the parent immediately even while a notify_parent child is still running', async () => {
    await insertSubagent({ ref: 2, notify_parent: true });
    await setAgentTurnTerminal(app, { id: primaryId }, userId, 'completed');
    expect((await agentRow(primaryId)).status).toBe('completed');
  });
});
