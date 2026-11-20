/**
 * The Slack bot end to end: events in, the owner's assistant created or messaged, answers posted
 * back to the right thread. Real (migrated) database; only Slack and session creation are mocked.
 */
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';

const slack = vi.hoisted(() => ({
  deleteMessage: vi.fn(),
  getChannelHistory: vi.fn(),
  getChannelInfo: vi.fn(),
  getMessageFiles: vi.fn(),
  getThreadReplies: vi.fn(),
  getUserInfo: vi.fn(),
  postEphemeral: vi.fn(),
  postMarkdown: vi.fn(),
  postMessage: vi.fn(),
  setAgentSessionStatus: vi.fn(),
  setThreadStatus: vi.fn(),
  updateMessage: vi.fn(),
}));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

const sessionTool = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../mcp/tools/create-session.js', () => ({ createCreateSessionTool: sessionTool.create }));

import { createSlackBot } from '../slack-bot.js';
import { resetSlackUserCache } from '../slack-users.js';
import {
  decryptedApp,
  insertAssistant,
  insertAssistantMessage,
  insertSlackApp,
  insertThread,
  insertUser,
  linkSlackUser,
  slackTestApp,
} from './slack-test-helpers.js';

const db = createTestDb();

const PEOPLE = { UOWNER: 'Jan', USTRANGER: 'Eva', UFRIEND: 'Tom' };

let eventCounter = 0;
const tag = (overrides = {}) => ({
  event_id: `Ev${(eventCounter += 1)}`,
  event: {
    type: 'app_mention',
    user: 'UOWNER',
    channel: 'C1',
    ts: '5.5',
    text: '<@UBOT> fix the login test',
    ...overrides,
  },
});
const talk = (overrides = {}) => ({
  event_id: `Ev${(eventCounter += 1)}`,
  event: {
    type: 'message',
    channel_type: 'channel',
    user: 'UOWNER',
    channel: 'C1',
    ts: '6.6',
    thread_ts: '5.5',
    text: 'also add tests',
    ...overrides,
  },
});

/** An owner linked to Slack, a bot, and a stand-in for the CreateSession tool. */
async function world({ linked = true, createFails = null } = {}) {
  const ownerId = await insertUser(db);
  const appId = await insertSlackApp(db);
  if (linked) await linkSlackUser(db, appId, 'UOWNER', ownerId);
  const slackApp = decryptedApp({ id: appId });

  const messages = [];
  const queued = [];
  const sessions = new EventEmitter();
  sessions.stop = vi.fn().mockResolvedValue({ ok: true });
  const services = {
    'admin/slack': { find: async () => [slackApp], get: async () => slackApp },
    users: { get: async (id) => db('users').where({ id }).first() },
    messages: {
      create: vi.fn(async (data, params) => {
        messages.push({ data, params });
        return data;
      }),
    },
    'queued-messages': {
      create: vi.fn(async (data, params) => {
        queued.push({ data, params });
        return data;
      }),
    },
    sessions,
  };
  const real = slackTestApp(db);
  const app = {
    get: () => db,
    service: (name) => services[name] ?? real.service(name),
  };

  const toolCalls = [];
  sessionTool.create.mockImplementation((context) => ({
    handler: async (args) => {
      toolCalls.push({ context, args });
      if (createFails) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: createFails }) }],
        };
      }
      const sessionId = await insertAssistant(db, context.userId, context.slackAppId);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, sessionId }) }] };
    },
  }));

  const bot = createSlackBot(app);
  bot.start();
  return {
    ownerId,
    appId,
    slackApp,
    messages,
    queued,
    sessions,
    toolCalls,
    bot,
    /** The owner's assistant, already running in a thread. */
    async assistantInThread({ threadTs = '5.5', status } = {}) {
      const sessionId = await insertAssistant(db, ownerId, appId, status ? { status } : {});
      await insertThread(db, sessionId, { thread_ts: threadTs });
      return sessionId;
    },
    /** The owner allowed this Slack user to talk to the assistant. */
    allow: (sessionId, slackUserId) =>
      db('slack_session_allowed_users').insert({
        session_id: sessionId,
        slack_user_id: slackUserId,
      }),
    /** The assistant finishes a turn, saying `text` (nothing when null). */
    async finishTurn(sessionId, text) {
      if (text != null) await insertAssistantMessage(db, sessionId, text);
      sessions.emit('turn:complete', { session_id: sessionId });
      await new Promise((resolve) => setTimeout(resolve, 30)); // the listener is async
    },
    messageText: (index = 0) => JSON.parse(messages[index].data.message_json).message.content,
    messageJson: (index = 0) => JSON.parse(messages[index].data.message_json),
  };
}

const markdownPosts = () => slack.postMarkdown.mock.calls.map(([, args]) => args);
const nothingSaid = () => {
  expect(slack.postMessage).not.toHaveBeenCalled();
  expect(slack.postMarkdown).not.toHaveBeenCalled();
  expect(slack.postEphemeral).not.toHaveBeenCalled();
};

beforeEach(() => {
  resetSlackUserCache();
  for (const fn of Object.values(slack)) fn.mockReset().mockResolvedValue(undefined);
  slack.postMessage.mockResolvedValue({ channel: 'C1', ts: '30.1' });
  slack.getThreadReplies.mockResolvedValue([]);
  slack.getChannelHistory.mockResolvedValue({ messages: [], hasMore: false, nextCursor: null });
  slack.getChannelInfo.mockResolvedValue({ name: 'dev', isPrivate: false });
  slack.getMessageFiles.mockResolvedValue([]);
  slack.getUserInfo.mockImplementation(async (_token, id) => ({ id, name: PEOPLE[id] }));
  sessionTool.create.mockReset();
});

describe('which events are ignored', () => {
  it.each([
    ['without a user', { user: undefined }],
    ['from a bot', { bot_id: 'B1' }],
    ['from the bot itself', { user: 'UBOT' }],
    ['edits', { type: 'message', subtype: 'message_changed' }],
  ])('%s', async (_name, overrides) => {
    const w = await world();
    await w.bot.handleEventCallback(w.slackApp, tag(overrides));
    expect(w.toolCalls).toHaveLength(0);
    nothingSaid();
  });

  it('direct messages', async () => {
    const w = await world();
    await w.bot.handleEventCallback(w.slackApp, talk({ channel_type: 'im', text: 'baguette hi' }));
    expect(w.toolCalls).toHaveLength(0);
  });

  it('channel chatter that is neither a tag nor in a thread', async () => {
    const w = await world();
    await w.bot.handleEventCallback(w.slackApp, talk({ thread_ts: undefined, text: 'lunch?' }));
    expect(w.toolCalls).toHaveLength(0);
  });

  it('events Slack delivers twice', async () => {
    const w = await world();
    const payload = tag();
    await w.bot.handleEventCallback(w.slackApp, payload);
    await w.bot.handleEventCallback(w.slackApp, payload);
    expect(w.toolCalls).toHaveLength(1);
  });
});

describe('the first message creates the assistant', () => {
  it('starts a global session for the owner with the message as its prompt', async () => {
    const w = await world();
    await w.bot.handleEventCallback(w.slackApp, tag());

    expect(w.toolCalls).toHaveLength(1);
    const { context, args } = w.toolCalls[0];
    expect(context).toMatchObject({ userId: w.ownerId, slackAppId: w.appId });
    expect(context.initialMessageMeta).toMatchObject({ source: 'slack' });
    expect(args.is_global).toBe(true);
    expect(args.initial_prompt).toContain('fix the login test');
    expect(args.initial_prompt).toContain('Slack context');
    expect(args.initial_prompt).toContain('channel C1, thread_ts 5.5');
    expect(w.messages).toHaveLength(0); // the prompt is the first message
  });

  it('records the thread, shows the working status and removes its placeholder', async () => {
    const w = await world();
    slack.postMessage.mockResolvedValueOnce({ channel: 'C1', ts: '7.7' });
    await w.bot.handleEventCallback(w.slackApp, tag());

    const assistant = await db('sessions').whereNotNull('slack_app_id').first();
    expect(await db('slack_session_threads').where({ session_id: assistant.id })).toHaveLength(1);
    expect(slack.setThreadStatus).toHaveBeenCalledWith(
      'xoxb-test',
      expect.objectContaining({ channel: 'C1', threadTs: '5.5' })
    );
    expect(slack.deleteMessage).toHaveBeenCalledWith('xoxb-test', { channel: 'C1', ts: '7.7' });
  });

  it('posts the assistant’s answer to the thread when its turn ends', async () => {
    const w = await world();
    await w.bot.handleEventCallback(w.slackApp, tag());
    const assistant = await db('sessions').whereNotNull('slack_app_id').first();

    await w.finishTurn(assistant.id, 'On it — started a session for that.');

    expect(markdownPosts()).toEqual([
      expect.objectContaining({
        channel: 'C1',
        threadTs: '5.5',
        markdown: 'On it — started a session for that.',
      }),
    ]);
    expect(w.bot.replyTarget(assistant.id)).toBeNull();
  });

  it('explains why it could not start (for example no default model) and creates nothing', async () => {
    const w = await world({
      createFails: 'No default builder model. Set one in Settings → Agent.',
    });
    slack.postMessage.mockResolvedValueOnce({ channel: 'C1', ts: '7.7' });
    await w.bot.handleEventCallback(w.slackApp, tag());

    expect(slack.updateMessage).toHaveBeenCalledWith(
      'xoxb-test',
      expect.objectContaining({ ts: '7.7', text: expect.stringContaining('Settings → Agent') })
    );
    expect(await db('sessions').whereNotNull('slack_app_id')).toHaveLength(0);
  });

  it('only says hello to an empty tag', async () => {
    const w = await world();
    await w.bot.handleEventCallback(w.slackApp, tag({ text: '<@UBOT>' }));
    expect(w.toolCalls).toHaveLength(0);
    expect(slack.postMessage.mock.calls[0][1].text).toMatch(/I'm here/);
  });

  it('creates a fresh assistant once the old one is archived', async () => {
    const w = await world();
    const old = await w.assistantInThread();
    await db('sessions').where({ id: old }).update({ archived_at: new Date().toISOString() });

    await w.bot.handleEventCallback(w.slackApp, tag());
    expect(w.toolCalls).toHaveLength(1);
  });
});

describe('one assistant for every thread', () => {
  it('passes a tag in another thread to the same assistant and answers there', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread({ threadTs: '5.5' });

    await w.bot.handleEventCallback(
      w.slackApp,
      tag({ ts: '8.8', text: '<@UBOT> what is running?' })
    );

    expect(w.toolCalls).toHaveLength(0);
    expect(w.messages).toHaveLength(1);
    expect(w.messages[0].data.session_id).toBe(sessionId);
    expect(w.messageText()).toContain('what is running?');
    expect(w.messageText()).toContain('channel C1, thread_ts 8.8');
    expect(w.messages[0].params.user.id).toBe(w.ownerId);
    expect(w.bot.replyTarget(sessionId)).toEqual({ channel: 'C1', threadTs: '8.8' });
    expect(await db('slack_session_threads').where({ session_id: sessionId })).toHaveLength(2);

    await w.finishTurn(sessionId, 'Two sessions are running.');
    expect(markdownPosts()[0]).toMatchObject({ threadTs: '8.8' });
  });

  it('labels the message as coming from Slack for the chat', async () => {
    const w = await world();
    await w.assistantInThread();
    await w.bot.handleEventCallback(w.slackApp, tag({ ts: '8.8' }));
    expect(w.messageJson()).toMatchObject({
      source: 'slack',
      slack: { user_id: 'UOWNER', user_name: 'Jan', untagged: false, allowed: false },
    });
  });

  it('lets the owner keep talking in a served thread without tagging', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await w.bot.handleEventCallback(w.slackApp, talk());
    expect(w.messages).toHaveLength(1);
    expect(w.messageText()).toContain('Untagged message');
    expect(w.messageJson().slack.untagged).toBe(true);
    expect(w.bot.replyTarget(sessionId)).toEqual({ channel: 'C1', threadTs: '5.5' });
  });

  it('ignores untagged talk in a thread the assistant does not serve', async () => {
    const w = await world();
    await w.assistantInThread({ threadTs: '1.1' });
    await w.bot.handleEventCallback(w.slackApp, talk());
    expect(w.messages).toHaveLength(0);
  });

  it('treats saying "baguette" in a thread as addressing it', async () => {
    const w = await world();
    await w.bot.handleEventCallback(w.slackApp, talk({ text: 'baguette, any news?' }));
    expect(w.toolCalls).toHaveLength(1);
  });

  it('keeps silent when the assistant answers NO_REPLY', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await w.bot.handleEventCallback(w.slackApp, talk());
    await w.finishTurn(sessionId, 'NO_REPLY');
    expect(markdownPosts()).toHaveLength(0);
  });
});

describe('who it listens to', () => {
  it('ignores a stranger in a thread the assistant serves — no reply, nothing delivered', async () => {
    const w = await world();
    await w.assistantInThread();
    await w.bot.handleEventCallback(
      w.slackApp,
      tag({ user: 'USTRANGER', thread_ts: '5.5', ts: '6.1', text: '<@UBOT> drop the table' })
    );
    await w.bot.handleEventCallback(w.slackApp, talk({ user: 'USTRANGER', text: 'hello?' }));
    expect(w.messages).toHaveLength(0);
    expect(w.toolCalls).toHaveLength(0);
    nothingSaid();
  });

  it('privately nudges someone who is not a Baguette user to log in, and does nothing else', async () => {
    const w = await world();
    await w.bot.handleEventCallback(w.slackApp, tag({ user: 'USTRANGER' }));
    expect(w.toolCalls).toHaveLength(0);
    expect(slack.postEphemeral).toHaveBeenCalledTimes(1);
    expect(slack.postEphemeral.mock.calls[0][1]).toMatchObject({ user: 'USTRANGER' });
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('does not create an assistant for an unapproved Baguette user', async () => {
    const w = await world();
    await db('users').where({ id: w.ownerId }).update({ status: 'pending' });
    await w.bot.handleEventCallback(w.slackApp, tag());
    expect(w.toolCalls).toHaveLength(0);
  });

  it('passes on an allowed person’s message as the owner’s assistant input, marked as theirs', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await w.allow(sessionId, 'UFRIEND');

    await w.bot.handleEventCallback(
      w.slackApp,
      talk({ user: 'UFRIEND', ts: '6.2', text: 'can you check the build?' })
    );

    expect(w.messages).toHaveLength(1);
    expect(w.messages[0].params.user.id).toBe(w.ownerId);
    expect(w.messageText()).toContain('allowed to talk to you');
    expect(w.messageText()).toContain('can you check the build?');
    expect(w.messageJson().slack).toMatchObject({ user_id: 'UFRIEND', allowed: true });
  });

  it('does not let an allowed person start anything in a thread the assistant does not serve', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread({ threadTs: '1.1' });
    await w.allow(sessionId, 'UFRIEND');
    await w.bot.handleEventCallback(w.slackApp, tag({ user: 'UFRIEND' }));
    expect(w.messages).toHaveLength(0);
    expect(w.toolCalls).toHaveLength(0);
  });
});

describe('delivery while the assistant is busy', () => {
  it('slips the message into a running turn', async () => {
    const w = await world();
    await w.assistantInThread({ status: 'running' });
    await db('agents').update({ status: 'running' });
    await w.bot.handleEventCallback(w.slackApp, talk());
    expect(w.messages[0].data.force).toBe(true);
    expect(w.messageText()).toContain('middle of a turn');
  });

  it('queues the message while the workspace is still being set up, telling the assistant where to answer', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await db('sessions').where({ id: sessionId }).update({ status: 'provisioning' });
    await w.bot.handleEventCallback(w.slackApp, talk());
    expect(w.messages).toHaveLength(0);
    expect(w.queued).toHaveLength(1);
    expect(JSON.parse(w.queued[0].data.message_json).message.content).toContain('queued');
    expect(w.bot.replyTarget(sessionId)).toBeNull();
  });

  it('answers in the thread of the newest message when two threads talk at once', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread({ threadTs: '5.5' });
    await insertThread(db, sessionId, { thread_ts: '8.8' });
    await w.bot.handleEventCallback(w.slackApp, talk());
    await w.bot.handleEventCallback(
      w.slackApp,
      talk({ thread_ts: '8.8', ts: '8.9', text: 'me too' })
    );
    await w.finishTurn(sessionId, 'Both noted.');
    expect(markdownPosts().map((post) => post.threadTs)).toEqual(['8.8']);
  });

  it('reports a failed delivery in the thread', async () => {
    const w = await world();
    await w.assistantInThread();
    await db('agents').delete(); // no builder agent
    await w.bot.handleEventCallback(w.slackApp, talk());
    expect(slack.postMessage.mock.calls.at(-1)[1].text).toMatch(/isn't available/);
  });
});

describe('answers', () => {
  it('posts nothing for a turn that answers no Slack message (a wake-up)', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await w.finishTurn(sessionId, 'Session 12 finished.');
    expect(markdownPosts()).toHaveLength(0);
  });

  it('replaces an answer that looks like it holds a secret', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await w.bot.handleEventCallback(w.slackApp, talk());
    await w.finishTurn(sessionId, 'The key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(markdownPosts()[0].markdown).not.toContain('sk-ant');
    expect(markdownPosts()[0].markdown).toContain(`/sessions/${sessionId}`);
  });

  it('retries a failed post with the next turn', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await w.bot.handleEventCallback(w.slackApp, talk());
    slack.postMarkdown.mockRejectedValueOnce(new Error('ratelimited'));
    await w.finishTurn(sessionId, 'First answer');
    expect(w.bot.replyTarget(sessionId)).not.toBeNull();

    await w.finishTurn(sessionId, 'Second answer');
    expect(markdownPosts().at(-1).markdown).toBe('Second answer');
    expect(w.bot.replyTarget(sessionId)).toBeNull();
  });

  it('clears the working status when the turn ends', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await w.bot.handleEventCallback(w.slackApp, talk());
    await w.finishTurn(sessionId, 'Done');
    expect(slack.setThreadStatus).toHaveBeenLastCalledWith(
      'xoxb-test',
      expect.objectContaining({ status: '' })
    );
  });
});

describe('the Stop button', () => {
  const stopped = (overrides = {}) => ({
    event_id: `Ev${(eventCounter += 1)}`,
    event: {
      type: 'agent_session_stopped',
      user: 'UOWNER',
      channel: 'C1',
      thread_ts: '5.5',
      ...overrides,
    },
  });

  it('lets the owner interrupt their assistant', async () => {
    const w = await world();
    const sessionId = await w.assistantInThread();
    await w.bot.handleEventCallback(w.slackApp, stopped());
    expect(w.sessions.stop).toHaveBeenCalledWith(sessionId, expect.anything());
  });

  it('tells anyone else privately that only the owner can', async () => {
    const w = await world();
    await w.assistantInThread();
    await w.bot.handleEventCallback(w.slackApp, stopped({ user: 'USTRANGER' }));
    expect(w.sessions.stop).not.toHaveBeenCalled();
    expect(slack.postEphemeral.mock.calls[0][1]).toMatchObject({ user: 'USTRANGER' });
  });
});
