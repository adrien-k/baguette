/**
 * Scheduled queued messages: kind=scheduled rows dispatched on send_at via messages.create.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { dispatchDueScheduledQueuedMessages } from '../scheduled-queued-messages.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb({ beforeEach, afterEach });

const params = (user) => ({ provider: 'rest', user });
const messageJson = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: 'Later' },
});

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  app.use(
    'claude-agent',
    { onMessageCreated: vi.fn().mockResolvedValue(undefined) },
    { methods: ['onMessageCreated'] }
  );
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

  await db('repos').insert({ full_name: 'test/repo', bare_path: '/tmp/repo' });
  const repo = await db('repos').where({ full_name: 'test/repo' }).first();

  [sessionId] = await db('sessions').insert({
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
        { session_id: sessionId, message_json: messageJson, send_at: sendAt },
        params({ id: userId })
      );
    expect(row.kind).toBe('scheduled');
    expect(row.send_at).toBeTruthy();
    expect(row.message_json).toBe(messageJson);
  });

  it('forbids external create', async () => {
    await expect(
      app
        .service('queued-messages')
        .create({ session_id: sessionId, message_json: messageJson }, params({ id: userId }))
    ).rejects.toThrow(/External access forbidden/);
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
    });

    await dispatchDueScheduledQueuedMessages(app);

    const queued = await db('queued_messages').where({ session_id: sessionId });
    expect(queued).toHaveLength(0);

    const messages = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(messages).toHaveLength(1);
  });

  it('queues into turn queue when session is running at dispatch time', async () => {
    await db('sessions').where({ id: sessionId }).update({ status: 'running' });
    const sendAt = new Date(Date.now() - 1_000).toISOString();
    await db('queued_messages').insert({
      session_id: sessionId,
      user_id: userId,
      message_json: messageJson,
      kind: 'scheduled',
      send_at: sendAt,
    });

    await dispatchDueScheduledQueuedMessages(app);

    const turnQueue = await db('queued_messages').where({ session_id: sessionId, kind: 'turn' });
    expect(turnQueue).toHaveLength(1);
    expect(turnQueue[0].message_json).toBe(messageJson);

    const messages = await db('session_messages').where({ session_id: sessionId, type: 'user' });
    expect(messages).toHaveLength(0);
  });
});
