/**
 * Integration tests for the messages Feathers service.
 * Messages are scoped by session ownership (scopeBySessionUser).
 * Creating a message also updates the parent session's status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb, insertTestSession, testMessageRow } from '../../test-utils/db.js';
import { registerAgentsService } from '../feathers/agents.service.js';
import { registerMessagesService } from '../feathers/messages.service.js';
import { registerSessionsService } from '../feathers/sessions.service.js';
import { registerQueuedMessagesService } from '../feathers/queued-messages.service.js';
import { registerReviewAgentTurn } from '../review-agent-turn.js';
import { buildMcpUserMessageJson } from '../mcp/lib/session-resolution.js';

vi.mock('../baguette-config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  };
});

const db = createTestDb();

const params = (user) => ({ provider: 'rest', user });
const unauthParams = { provider: 'rest' };

async function builderFields(extra = {}) {
  const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
  return {
    agent_id: builder.id,
    agent_sdk: 'claude',
    model: 'sonnet',
    model_params: '[{"id":"effort","value":"high"}]',
    ...extra,
  };
}

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSessionsService(app);
  registerReviewAgentTurn(app);
  registerAgentsService(app);
  app.use(
    'claude-agent',
    {
      onMessageCreated: vi.fn().mockResolvedValue(undefined),
      syncSessionSettingsFromPatch: vi.fn(),
    },
    { methods: ['onMessageCreated', 'syncSessionSettingsFromPatch'] }
  );
  registerMessagesService(app);
  registerQueuedMessagesService(app);
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
    model: 'sonnet',
    model_params: '[{"id":"effort","value":"high"}]',
  });
  otherSessionId = await insertTestSession(db, {
    user_id: otherUserId,
    repo_id: repo.id,
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: 'Other',
    short_id: 'cc22dd',
    status: 'active',
    model: 'sonnet',
  });

  [msgId] = await db('session_messages').insert(
    await testMessageRow(db, sessionId, {
      type: 'assistant',
      message_json: JSON.stringify({ type: 'assistant', content: 'Hello' }),
    })
  );

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

  it('ignores legacy agent_type in find query (column dropped)', async () => {
    const result = await app.service('messages').find({
      query: { session_id: sessionId, agent_type: 'builder' },
      ...params({ id: userId }),
    });
    const data = result.data ?? result;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(msgId);
  });

  it('does not error on legacy agent_type when session has no primary builder', async () => {
    const repo = await db('repos').where({ full_name: 'test/repo' }).first();
    const bareSessionId = await insertTestSession(db, {
      user_id: userId,
      repo_id: repo.id,
      repo_full_name: 'test/repo',
      base_branch: 'main',
      initial_prompt: 'No builder',
      short_id: 'ee33ff',
      status: 'active',
    });
    await db('agents').where({ session_id: bareSessionId }).delete();

    const result = await app.service('messages').find({
      query: { session_id: bareSessionId, agent_type: 'builder' },
      ...params({ id: userId }),
    });
    expect(result.data ?? result).toHaveLength(0);
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
        ...(await builderFields()),
      },
      params({ id: userId })
    );
    expect(msg.session_id).toBe(sessionId);
    expect(msg.type).toBe('user');
    expect(msg.model).toBe('sonnet');
    expect(msg.model_params).toBe('[{"id":"effort","value":"high"}]');
  });

  it('stores an explicit turn model snapshot without changing the session', async () => {
    await db('agents').where({ session_id: sessionId, is_primary: 1 }).update({ model: 'opus' });
    const msg = await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
        ...(await builderFields({
          model: 'sonnet',
          model_params: '[{"id":"fast","value":"true"}]',
        })),
      },
      params({ id: userId })
    );
    expect(msg.model).toBe('sonnet');
    expect(msg.model_params).toBe('[{"id":"fast","value":"true"}]');
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    expect(builder.model).toBe('opus');
  });

  it('calls sessions.onMessageCreated after create', async () => {
    const sessionsOnMessage = vi.spyOn(app.service('sessions'), 'onMessageCreated');
    await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
        ...(await builderFields()),
      },
      params({ id: userId })
    );
    expect(sessionsOnMessage).toHaveBeenCalledOnce();
    sessionsOnMessage.mockRestore();
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
// agent_type / queueWhileRunning
// ---------------------------------------------------------------------------

describe('Messages service - agent_id scoping and queue', () => {
  it('defaults find to primary builder rows only', async () => {
    const [reviewerId] = await db('agents').insert({
      session_id: sessionId,
      name: 'Reviewer',
      agent_type: 'reviewer',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: 'claude',
      model: 'sonnet',
      agent_config_id: (await db('agents').where({ session_id: sessionId, is_primary: 1 }).first())
        .agent_config_id,
      current_turn_id: 0,
    });
    await db('session_messages').insert({
      session_id: sessionId,
      agent_id: reviewerId,
      agent_sdk: 'claude',
      model: 'sonnet',
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: 'review' } }),
    });

    const result = await app.service('messages').find({
      query: { session_id: sessionId },
      ...params({ id: userId }),
    });
    const data = result.data ?? result;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(msgId);
  });

  it('allows client create for reviewer when agent_id is set', async () => {
    const [reviewerId] = await db('agents').insert({
      session_id: sessionId,
      name: 'Reviewer',
      agent_type: 'reviewer',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: 'claude',
      model: 'sonnet',
      agent_config_id: (await db('agents').where({ session_id: sessionId, is_primary: 1 }).first())
        .agent_config_id,
      current_turn_id: 0,
    });
    await db('sessions').where({ id: sessionId }).update({ session_path: '/tmp/test-worktree' });
    const result = await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        agent_id: reviewerId,
        agent_sdk: 'claude',
        model: 'sonnet',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'review follow-up' },
        }),
      },
      params({ id: userId })
    );
    expect(result.id).toBeTruthy();
    expect(result.agent_id).toBe(reviewerId);
  });

  it('queues an extra builder MCP message while the session is provisioning', async () => {
    await db('sessions').where({ id: sessionId }).update({ status: 'provisioning' });
    const primary = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    const [extraBuilderId] = await db('agents').insert({
      session_id: sessionId,
      ref: 2,
      name: 'Extra',
      agent_type: 'subagent',
      is_primary: 0,
      status: 'stopped',
      agent_sdk: primary.agent_sdk,
      model: primary.model,
      model_params: primary.model_params,
      agent_config_id: primary.agent_config_id,
      current_turn_id: 0,
    });

    const result = await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        subtype: 'mcp',
        message_json: buildMcpUserMessageJson('during provision'),
        agent_id: extraBuilderId,
        agent_sdk: primary.agent_sdk,
        model: primary.model,
        model_params: primary.model_params,
        agent_config_id: primary.agent_config_id,
      },
      params({ id: userId })
    );

    expect(result).toEqual({ queued: true });
    const queued = await db('queued_messages').where({
      session_id: sessionId,
      agent_id: extraBuilderId,
      kind: 'turn',
    });
    expect(queued).toHaveLength(1);
  });

  it('queues a builder user message while the session turn is running', async () => {
    await db('agents')
      .where({ session_id: sessionId, is_primary: 1 })
      .update({ status: 'running' });

    const result = await app.service('messages').create(
      {
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'follow up' },
        }),
        ...(await builderFields()),
      },
      params({ id: userId })
    );

    expect(result).toEqual({ queued: true });
    const queued = await db('queued_messages').where({ session_id: sessionId });
    expect(queued).toHaveLength(1);
    const builder = await db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
    expect(queued[0].agent_id).toBe(builder.id);
    expect(queued[0].kind).toBe('turn');
    expect(queued[0].agent_sdk).toBe('claude');
    expect(queued[0].model).toBe('sonnet');
  });

  it('rejects create without required identity fields', async () => {
    await expect(
      app.service('messages').create(
        {
          session_id: sessionId,
          type: 'user',
          message_json: JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'Hi' },
          }),
        },
        params({ id: userId })
      )
    ).rejects.toThrow(/Missing required message fields/);
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
