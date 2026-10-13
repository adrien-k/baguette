/**
 * Scheduled queued messages: kind=scheduled rows dispatched on send_at via messages.create.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { useClaudeAgentStub } from '../../test-utils/agent-sdks.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb();

const params = (user) => ({ provider: 'rest', user });
const messageJson = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: 'Later' },
});

const builderIdentity = (extra = {}) => ({
  agent_type: 'builder',
  agent_sdk: 'claude',
  model: 'sonnet',
  ...extra,
});

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerAgentsService(app);
  useClaudeAgentStub(app, { onMessageCreated: vi.fn().mockResolvedValue(undefined) }, [
    'onMessageCreated',
  ]);
  registerQueuedMessagesService(app);
  registerMessagesService(app);
  return app;
}

let app;
let userId;
let sessionId;
beforeEach(async () => {
  vi.clearAllMocks();

  await db('users').insert({ github_id: 101, username: 'alice', approved: true });
  const alice = await db('users').where({ username: 'alice' }).first();
  userId = alice.id;

  await db('repos').insert({ full_name: 'test/repo', repo_path: '/tmp/repo' });
  const repo = await db('repos').where({ full_name: 'test/repo' }).first();

  sessionId = await insertTestSession(db, {
    user_id: userId,
    repo_id: repo.id,
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: 'Task',
    short_id: 'aa11bb',
    status: 'active',
  });

  app = makeApp(db);
  await app.setup();
});

describe('queued-messages schedule', () => {
  it('creates a scheduled row via schedule()', async () => {
    const sendAt = new Date(Date.now() + 60_000).toISOString();
    const row = await app
      .service('queued-messages')
      .schedule(
        { session_id: sessionId, message_json: messageJson, send_at: sendAt, ...builderIdentity() },
        params({ id: userId })
      );
    expect(row.kind).toBe('scheduled');
    expect(row.send_at).toBeTruthy();
    expect(row.message_json).toBe(messageJson);
  });

  it('stores model snapshot on schedule()', async () => {
    const sendAt = new Date(Date.now() + 60_000).toISOString();
    const row = await app.service('queued-messages').schedule(
      {
        session_id: sessionId,
        message_json: messageJson,
        send_at: sendAt,
        ...builderIdentity({ model: 'sonnet', model_params: '[{"id":"fast"}]' }),
      },
      params({ id: userId })
    );
    expect(row.model).toBe('sonnet');
    expect(row.model_params).toBe('[{"id":"fast"}]');
  });

  it('forbids external create', async () => {
    await expect(
      app
        .service('queued-messages')
        .create({ session_id: sessionId, message_json: messageJson }, params({ id: userId }))
    ).rejects.toThrow(/External access forbidden/);
  });

  it('patch keeps kind=scheduled when another queued row exists', async () => {
    const sendAt = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await app
      .service('queued-messages')
      .schedule(
        { session_id: sessionId, message_json: messageJson, send_at: sendAt, ...builderIdentity() },
        params({ id: userId })
      );

    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      message_json: JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Turn queue' },
      }),
      kind: 'turn',
      send_at: null,
      ...builderIdentity(),
    });

    const updatedJson = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Edited later' },
    });
    const patched = await app
      .service('queued-messages')
      .patch(scheduled.id, { message_json: updatedJson }, params({ id: userId }));

    expect(patched.kind).toBe('scheduled');
    expect(patched.send_at).toBeTruthy();
    expect(patched.message_json).toBe(updatedJson);
  });
});

describe('scheduled dispatcher', () => {
  it('sends due messages through messages.create when session is idle', async () => {
    const sendAt = new Date(Date.now() - 1_000).toISOString();
    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      message_json: messageJson,
      kind: 'scheduled',
      send_at: sendAt,
      ...builderIdentity(),
    });

    await app.service('queued-messages').runDue();

    const queued = await db('queued_messages').where({ session_id: sessionId });
    expect(queued).toHaveLength(0);

    const messages = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(messages).toHaveLength(1);
    expect(messages[0].model).toBe('sonnet');
  });

  it('passes the queued model onto the created message', async () => {
    const sendAt = new Date(Date.now() - 1_000).toISOString();
    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      message_json: messageJson,
      kind: 'scheduled',
      send_at: sendAt,
      ...builderIdentity({ model: 'sonnet', model_params: '[{"id":"fast"}]' }),
    });

    await app.service('queued-messages').runDue();

    const messages = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(messages).toHaveLength(1);
    expect(messages[0].model).toBe('sonnet');
    expect(messages[0].model_params).toBe('[{"id":"fast"}]');
  });

  it('queues into turn queue when session is running at dispatch time', async () => {
    await db('agents')
      .where({ session_id: sessionId, is_primary: 1 })
      .update({ status: 'running' });
    const sendAt = new Date(Date.now() - 1_000).toISOString();
    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      message_json: messageJson,
      kind: 'scheduled',
      send_at: sendAt,
      ...builderIdentity(),
    });

    await app.service('queued-messages').runDue();

    const turnQueue = await db('queued_messages').where({ session_id: sessionId, kind: 'turn' });
    expect(turnQueue).toHaveLength(1);
    expect(JSON.parse(turnQueue[0].message_json)).toEqual({
      type: 'user',
      content: 'Later',
    });

    const messages = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(messages).toHaveLength(0);
  });
});
