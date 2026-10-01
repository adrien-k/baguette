/**
 * Integration tests for the messages Feathers service.
 * Messages are scoped by session ownership (scopeBySessionUser).
 * Creating a message also updates the parent session's status.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb({ beforeEach, afterEach });

const params = (user) => ({ provider: 'rest', user });
const unauthParams = { provider: 'rest' };

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  app.use(
    'claude-agent',
    {
      onMessageCreated: vi.fn().mockResolvedValue(undefined),
      syncSessionSettingsFromPatch: vi.fn(),
    },
    { methods: ['onMessageCreated', 'syncSessionSettingsFromPatch'] }
  );
  registerMessagesService(app);
  return app;
}

let app;
let userId;
let otherUserId;
let sessionId;
let otherSessionId;
let msgId;

beforeEach(async () => {
  vi.clearAllMocks();

  await db('users').insert([
    { github_id: 101, username: 'alice', approved: true },
    { github_id: 102, username: 'bob', approved: true },
  ]);
  const alice = await db('users').where({ username: 'alice' }).first();
  const bob = await db('users').where({ username: 'bob' }).first();
  userId = alice.id;
  otherUserId = bob.id;

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
    model: 'sonnet',
    model_params: '[{"id":"effort","value":"high"}]',
  });
  [otherSessionId] = await db('sessions').insert({
    user_id: otherUserId,
    repo_id: repo.id,
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: 'Other',
    short_id: 'cc22dd',
    status: 'active',
  });

  [msgId] = await db('session_messages').insert({
    session_id: sessionId,
    type: 'assistant',
    message_json: JSON.stringify({ type: 'assistant', content: 'Hello' }),
  });

  app = makeApp(db);
  await app.setup();
});

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

describe('Messages service - find', () => {
  it('returns messages for sessions owned by the user', async () => {
    const result = await app.service('messages').find({
      query: { session_id: sessionId },
      ...params({ id: userId }),
    });
    const data = result.data ?? result;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(msgId);
    expect(data[0].session_id).toBe(sessionId);
  });

  it("returns no messages for another user's session", async () => {
    // alice querying bob's session — scopeBySessionUser filters it out
    const result = await app.service('messages').find({
      query: { session_id: otherSessionId },
      ...params({ id: userId }),
    });
    const data = result.data ?? result;
    expect(data).toHaveLength(0);
  });

  it('rejects when not authenticated', async () => {
    await expect(app.service('messages').find({ query: {}, ...unauthParams })).rejects.toThrow(
      'Not authenticated'
    );
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('Messages service - get', () => {
  it("returns a message that belongs to the user's session", async () => {
    const msg = await app.service('messages').get(msgId, params({ id: userId }));
    expect(msg.id).toBe(msgId);
    expect(msg.session_id).toBe(sessionId);
  });

  it("returns 404 for a message in another user's session", async () => {
    const [otherMsgId] = await db('session_messages').insert({
      session_id: otherSessionId,
      type: 'assistant',
      message_json: JSON.stringify({ type: 'assistant' }),
    });
    await expect(app.service('messages').get(otherMsgId, params({ id: userId }))).rejects.toThrow();
  });

  it('rejects when not authenticated', async () => {
    await expect(app.service('messages').get(msgId, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('Messages service - create', () => {
  it('creates a message for an owned session', async () => {
    const msg = await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
      },
      params({ id: userId })
    );
    expect(msg.session_id).toBe(sessionId);
    expect(msg.type).toBe('user');
    expect(msg.model).toBe('sonnet');
    expect(msg.model_params).toBe('[{"id":"effort","value":"high"}]');
  });

  it('stores an explicit turn model snapshot without changing the session', async () => {
    await db('sessions').where({ id: sessionId }).update({ model: 'opus' });
    const msg = await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
        model: 'sonnet',
        model_params: '[{"id":"fast","value":"true"}]',
      },
      params({ id: userId })
    );
    expect(msg.model).toBe('sonnet');
    expect(msg.model_params).toBe('[{"id":"fast","value":"true"}]');
    const session = await db('sessions').where({ id: sessionId }).first();
    expect(session.model).toBe('opus');
  });

  it('rejects model without model_params', async () => {
    await expect(
      app.service('messages').create(
        {
          session_id: sessionId,
          type: 'user',
          message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
          model: 'sonnet',
        },
        params({ id: userId })
      )
    ).rejects.toThrow(/both be set/);
  });

  it('calls sessions.onMessageCreated and claude-agent.onMessageCreated after create', async () => {
    const onMessageCreated = app.service('claude-agent').onMessageCreated;
    const msg = await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
      },
      params({ id: userId })
    );
    expect(onMessageCreated).toHaveBeenCalledOnce();
    expect(onMessageCreated).toHaveBeenCalledWith(msg, expect.anything());
  });

  it("rejects creating a message for another user's session", async () => {
    await expect(
      app
        .service('messages')
        .create(
          { session_id: otherSessionId, type: 'user', message_json: '{}' },
          params({ id: userId })
        )
    ).rejects.toThrow(/No record found/);
  });

  it('rejects when not authenticated', async () => {
    await expect(
      app
        .service('messages')
        .create({ session_id: sessionId, type: 'user', message_json: '{}' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('Messages service - remove', () => {
  it('removes a message in an owned session', async () => {
    await app.service('messages').remove(msgId, params({ id: userId }));
    const row = await db('session_messages').where({ id: msgId }).first();
    expect(row).toBeUndefined();
  });

  it("rejects removing a message in another user's session", async () => {
    const [otherMsgId] = await db('session_messages').insert({
      session_id: otherSessionId,
      type: 'assistant',
      message_json: JSON.stringify({ type: 'assistant' }),
    });
    await expect(
      app.service('messages').remove(otherMsgId, params({ id: userId }))
    ).rejects.toThrow();
  });

  it('rejects when not authenticated', async () => {
    await expect(app.service('messages').remove(msgId, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});
