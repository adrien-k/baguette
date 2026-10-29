/**
 * The Slack tools an agent gets in a session: post, edit, read thread/channel, download, archive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';

const slack = vi.hoisted(() => ({
  getChannelInfo: vi.fn(),
  isChannelMember: vi.fn(),
  getChannelHistory: vi.fn(),
  getFileInfo: vi.fn(),
  getPermalink: vi.fn(),
  getThreadReplies: vi.fn(),
  getUserInfo: vi.fn(),
  postMessage: vi.fn(),
  resolveChannelId: vi.fn(),
  updateMessage: vi.fn(),
}));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

const system = vi.hoisted(() => ({ getSystemInfo: vi.fn() }));
vi.mock('../system-information.js', () => system);

const files = vi.hoisted(() => ({ downloadSlackFile: vi.fn() }));
vi.mock('../slack-files.js', async (importOriginal) => ({ ...(await importOriginal()), ...files }));

import { SlackApiError } from '../slack.js';
import { SlackFileError } from '../slack-files.js';
import { resetSlackUserCache } from '../slack-users.js';
import { createArchiveSessionTool } from '../mcp/tools/archive-session.js';
import { createSlackDownloadFileTool } from '../mcp/tools/slack-download-file.js';
import { createSlackEditMessageTool } from '../mcp/tools/slack-edit-message.js';
import { createSlackPostMessageTool } from '../mcp/tools/slack-post-message.js';
import { createSlackReadChannelTool } from '../mcp/tools/slack-read-channel.js';
import { createSessionCostTool } from '../mcp/tools/session-cost.js';
import { createSystemStatsTool, formatBytes, formatDuration } from '../mcp/tools/system-stats.js';
import { createSlackReadThreadTool, parseSlackThreadUrl } from '../mcp/tools/slack-read-thread.js';
import {
  decryptedApp,
  insertSession,
  insertSlackApp,
  insertThread,
  insertUser,
  linkSlackUser,
  slackTestApp,
} from './slack-test-helpers.js';

const db = createTestDb();

/** Tool context for a session; `bound` ties it to a Slack thread (C1 / 9.9). */
async function toolContext({ bound = true, apps } = {}) {
  const userId = await insertUser(db);
  const appId = await insertSlackApp(db);
  const sessionId = await insertSession(db, userId);
  if (bound) {
    await insertThread(db, { slack_app_id: appId, session_id: sessionId, user_id: userId });
  }
  const slackApps = apps ?? [decryptedApp({ id: appId })];
  const threads = slackTestApp(db).service('slack-threads');
  return {
    appId,
    sessionId,
    userId,
    ctx: {
      app: {
        get: () => db,
        service: (name) => (name === 'slack-threads' ? threads : { find: async () => slackApps }),
      },
      slackApps,
      session: { id: sessionId },
      getSession: async () => ({ id: sessionId, agent_sdk: 'claude', model: 'haiku' }),
      describeAgent: () => 'Claude haiku',
    },
  };
}

const result = async (tool, args = {}) => JSON.parse((await tool.handler(args)).content[0].text);

beforeEach(() => {
  resetSlackUserCache();
  for (const fn of Object.values(slack)) fn.mockReset();
  files.downloadSlackFile.mockReset();
  slack.postMessage.mockResolvedValue({ channel: 'C1', ts: '10.1' });
  slack.getPermalink.mockResolvedValue('https://slack/permalink');
  slack.resolveChannelId.mockImplementation(async (_token, channel) => `ID:${channel}`);
  slack.getUserInfo.mockImplementation(async (_t, id) => ({ id, name: `name-${id}` }));
  slack.getChannelInfo.mockResolvedValue({ name: 'eng', isPrivate: false, isDirect: false });
  slack.isChannelMember.mockResolvedValue(false);
});

describe('SlackPostMessage', () => {
  it('with just text posts into the session’s thread, without a footer', async () => {
    const { ctx } = await toolContext();
    const out = await result(createSlackPostMessageTool(ctx), { text: 'Halfway there' });
    expect(slack.postMessage).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      threadTs: '9.9',
      text: 'Halfway there',
    });
    expect(out).toMatchObject({
      ok: true,
      channel: 'C1',
      ts: '10.1',
      permalink: 'https://slack/permalink',
    });
  });

  it('posts elsewhere when given a channel, with a footer saying where it came from', async () => {
    const { ctx, sessionId } = await toolContext();
    await result(createSlackPostMessageTool(ctx), { text: 'FYI', channel: '#eng' });
    const [, args] = slack.postMessage.mock.calls[0];
    expect(args.channel).toBe('ID:#eng');
    expect(args.threadTs).toBeUndefined();
    expect(args.text).toContain('FYI');
    expect(args.text).toContain(`session ${sessionId}`);
  });

  it('can reply in a given thread', async () => {
    const { ctx } = await toolContext();
    await result(createSlackPostMessageTool(ctx), { text: 'x', channel: 'C7', thread_ts: '1.1' });
    expect(slack.postMessage.mock.calls[0][1]).toMatchObject({ channel: 'ID:C7', threadTs: '1.1' });
  });

  it('needs a channel when the session was not started from Slack', async () => {
    const { ctx } = await toolContext({ bound: false });
    const out = await result(createSlackPostMessageTool(ctx), { text: 'x' });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('channel is required');
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('still works without a permalink', async () => {
    const { ctx } = await toolContext();
    slack.getPermalink.mockRejectedValue(new Error('nope'));
    expect(await result(createSlackPostMessageTool(ctx), { text: 'x' })).toMatchObject({
      ok: true,
      permalink: null,
    });
  });

  it('turns Slack errors into tool errors with a hint', async () => {
    const { ctx } = await toolContext();
    slack.postMessage.mockRejectedValue(new SlackApiError('chat.postMessage', 'not_in_channel'));
    const out = await result(createSlackPostMessageTool(ctx), { text: 'x' });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('not a member of that channel');
  });

  it('asks which app when several exist, and rejects an unknown one', async () => {
    const { ctx, appId } = await toolContext({ bound: false });
    ctx.slackApps = [decryptedApp({ id: appId }), decryptedApp({ id: appId + 1, name: 'second' })];
    ctx.app.service = () => ({ find: async () => ctx.slackApps });
    const tool = createSlackPostMessageTool(ctx);
    expect((await result(tool, { text: 'x', channel: 'C1' })).error).toContain(
      'Multiple Slack apps'
    );
    expect((await result(tool, { text: 'x', channel: 'C1', app: 'nope' })).error).toContain(
      'Unknown Slack app'
    );
    expect((await result(tool, { text: 'x', channel: 'C1', app: 'second' })).ok).toBe(true);
  });
});

describe('secrets never go to Slack through the tools', () => {
  const leak = 'here you go: DB_PASSWORD=correct-horse-battery';

  it('SlackPostMessage refuses a message with a secret, even in its own thread', async () => {
    const { ctx, sessionId } = await toolContext();
    const out = await result(createSlackPostMessageTool(ctx), { text: leak });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('Blocked');
    expect(out.error).toContain(`/sessions/${sessionId}`);
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('SlackPostMessage refuses it for any channel', async () => {
    const { ctx } = await toolContext();
    const out = await result(createSlackPostMessageTool(ctx), { text: leak, channel: '#eng' });
    expect(out.ok).toBe(false);
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it('SlackEditMessage will not turn a message into one with a secret', async () => {
    const { ctx } = await toolContext();
    const out = await result(createSlackEditMessageTool(ctx), { ts: '1.1', text: leak });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('Blocked');
    expect(slack.updateMessage).not.toHaveBeenCalled();
  });

  it('both tools remind the agent in their description', () => {
    const post = createSlackPostMessageTool({ slackApps: [], app: {} });
    const edit = createSlackEditMessageTool({ slackApps: [], app: {} });
    expect(post.description).toContain('NEVER post secrets');
    expect(edit.description).toContain('Never put secrets');
  });
});

describe('SlackEditMessage', () => {
  it('edits a message in the session’s thread', async () => {
    const { ctx } = await toolContext();
    const out = await result(createSlackEditMessageTool(ctx), { ts: '10.1', text: 'Done ✅' });
    expect(slack.updateMessage).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      ts: '10.1',
      text: 'Done ✅',
    });
    expect(out).toMatchObject({ ok: true, ts: '10.1' });
  });

  it('edits a message in another channel', async () => {
    const { ctx } = await toolContext();
    await result(createSlackEditMessageTool(ctx), { ts: '1.1', text: 'x', channel: 'C5' });
    expect(slack.updateMessage.mock.calls[0][1].channel).toBe('ID:C5');
  });

  it('needs a channel when the session was not started from Slack', async () => {
    const { ctx } = await toolContext({ bound: false });
    const out = await result(createSlackEditMessageTool(ctx), { ts: '1.1', text: 'x' });
    expect(out.error).toContain('channel is required');
  });

  it('turns Slack errors into tool errors', async () => {
    const { ctx } = await toolContext();
    slack.updateMessage.mockRejectedValue(new SlackApiError('chat.update', 'cant_update_message'));
    const out = await result(createSlackEditMessageTool(ctx), { ts: '1.1', text: 'x' });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('cant_update_message');
  });
});

describe('parseSlackThreadUrl', () => {
  it('reads the channel and message timestamp from a permalink', () => {
    expect(
      parseSlackThreadUrl('https://futrou.slack.com/archives/C0CDJA4UTFA/p1793147747403329')
    ).toEqual({
      channel: 'C0CDJA4UTFA',
      threadTs: '1793147747.403329',
    });
  });

  it('prefers thread_ts when the link points at a reply', () => {
    expect(
      parseSlackThreadUrl(
        'https://x.slack.com/archives/C1ABC/p1793147747403329?thread_ts=1793147000.000100&cid=C1ABC'
      )
    ).toEqual({ channel: 'C1ABC', threadTs: '1793147000.000100' });
  });

  it('returns null for anything else', () => {
    expect(parseSlackThreadUrl('https://example.com/nope')).toBeNull();
    expect(parseSlackThreadUrl('not a url')).toBeNull();
  });
});

describe('SlackReadThread', () => {
  const replies = [
    { ts: '1.0', user: 'U1', text: 'bug!', is_bot: false, files: [{ id: 'F1', name: 'a.json' }] },
    { ts: '1.1', user: 'UBOT', text: 'looking', is_bot: true, files: [] },
  ];

  it('reads the session’s own thread by default, with author names and files', async () => {
    const { ctx } = await toolContext();
    slack.getThreadReplies.mockResolvedValue(replies);
    const out = await result(createSlackReadThreadTool(ctx));
    expect(slack.getThreadReplies).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      ts: '9.9',
      limit: 200,
    });
    expect(out).toMatchObject({ ok: true, channel: 'C1', thread_ts: '9.9' });
    expect(out.messages[0]).toMatchObject({
      user: 'U1',
      user_name: 'name-U1',
      files: [{ id: 'F1', name: 'a.json' }],
    });
  });

  it('reads a thread the user linked to', async () => {
    const { ctx } = await toolContext();
    slack.getThreadReplies.mockResolvedValue(replies);
    await result(createSlackReadThreadTool(ctx), {
      url: 'https://x.slack.com/archives/C9/p1793147747403329',
    });
    expect(slack.getThreadReplies.mock.calls[0][1]).toMatchObject({
      channel: 'C9',
      ts: '1793147747.403329',
    });
  });

  it('reads an explicit channel and thread_ts', async () => {
    const { ctx } = await toolContext({ bound: false });
    slack.getThreadReplies.mockResolvedValue([]);
    await result(createSlackReadThreadTool(ctx), { channel: 'C4', thread_ts: '2.2' });
    expect(slack.getThreadReplies.mock.calls[0][1]).toMatchObject({ channel: 'C4', ts: '2.2' });
  });

  it('asks the agent to get a link when the url is not a Slack link', async () => {
    const { ctx } = await toolContext();
    const out = await result(createSlackReadThreadTool(ctx), { url: 'https://example.com' });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('Copy link');
  });

  it('asks the agent to ask the user when the session has no Slack thread and nothing was given', async () => {
    const { ctx } = await toolContext({ bound: false });
    const out = await result(createSlackReadThreadTool(ctx));
    expect(out.ok).toBe(false);
    expect(out.error).toContain('not tied to a Slack thread');
  });

  it.each(['channel_not_found', 'not_in_channel', 'thread_not_found'])(
    'explains %s in a way the agent can act on',
    async (code) => {
      const { ctx } = await toolContext();
      slack.getThreadReplies.mockRejectedValue(new SlackApiError('conversations.replies', code));
      const out = await result(createSlackReadThreadTool(ctx));
      expect(out.ok).toBe(false);
      expect(out.error).toContain(code);
      expect(out.error).toContain('invite it');
    }
  );

  it('reports other Slack errors as tool errors', async () => {
    const { ctx } = await toolContext();
    slack.getThreadReplies.mockRejectedValue(
      new SlackApiError('conversations.replies', 'ratelimited')
    );
    expect((await result(createSlackReadThreadTool(ctx))).ok).toBe(false);
  });
});

describe('SlackReadChannel', () => {
  const page = {
    messages: [{ ts: '1.1', user: 'U1', text: 'hi', is_bot: false, files: [] }],
    hasMore: true,
    nextCursor: 'abc',
  };

  it('reads a small page of the session’s channel by default and returns a cursor', async () => {
    const { ctx } = await toolContext();
    slack.getChannelHistory.mockResolvedValue(page);
    const out = await result(createSlackReadChannelTool(ctx));
    expect(slack.getChannelHistory).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      limit: 20,
      cursor: undefined,
      latest: undefined,
      oldest: undefined,
    });
    expect(out).toMatchObject({ ok: true, channel: 'C1', has_more: true, next_cursor: 'abc' });
    expect(out.messages[0]).toMatchObject({ user: 'U1', user_name: 'name-U1', text: 'hi' });
  });

  it('passes the cursor, limit and time bounds through, capping the limit at 100', async () => {
    const { ctx } = await toolContext();
    slack.getChannelHistory.mockResolvedValue(page);
    await result(createSlackReadChannelTool(ctx), {
      limit: 500,
      cursor: 'abc',
      latest: '9.0',
      oldest: '1.0',
    });
    expect(slack.getChannelHistory.mock.calls[0][1]).toEqual({
      channel: 'C1',
      limit: 100,
      cursor: 'abc',
      latest: '9.0',
      oldest: '1.0',
    });
  });

  it('reads another channel by name', async () => {
    const { ctx } = await toolContext();
    slack.getChannelHistory.mockResolvedValue(page);
    await result(createSlackReadChannelTool(ctx), { channel: '#eng' });
    expect(slack.getChannelHistory.mock.calls[0][1].channel).toBe('ID:#eng');
  });

  it('needs a channel when the session was not started from Slack', async () => {
    const { ctx } = await toolContext({ bound: false });
    expect((await result(createSlackReadChannelTool(ctx))).error).toContain('channel is required');
  });

  it.each(['channel_not_found', 'not_in_channel', 'missing_scope'])(
    'tells the agent to ask the user when Slack says %s',
    async (code) => {
      const { ctx } = await toolContext();
      slack.getChannelHistory.mockRejectedValue(new SlackApiError('conversations.history', code));
      const out = await result(createSlackReadChannelTool(ctx));
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/invite it|paste a link/);
    }
  );

  it('reports other Slack errors as tool errors', async () => {
    const { ctx } = await toolContext();
    slack.getChannelHistory.mockRejectedValue(
      new SlackApiError('conversations.history', 'ratelimited')
    );
    expect((await result(createSlackReadChannelTool(ctx))).ok).toBe(false);
  });
});

describe('SlackDownloadFile', () => {
  const file = {
    id: 'F1',
    name: 'data.json',
    mimetype: 'application/json',
    url: 'https://f/1',
    channel_ids: ['C1'],
    user_id: 'UUP',
  };

  it('downloads a file and returns its path and text', async () => {
    const { ctx, sessionId } = await toolContext();
    slack.getFileInfo.mockResolvedValue(file);
    files.downloadSlackFile.mockResolvedValue({ path: '/data/f1.json', size: 7, text: '{"a":1}' });

    const out = await result(createSlackDownloadFileTool(ctx), { file_id: 'F1' });

    expect(slack.getFileInfo).toHaveBeenCalledWith('xoxb-test', 'F1');
    expect(files.downloadSlackFile.mock.calls[0][2]).toMatch(new RegExp(`session-${sessionId}$`));
    expect(out).toMatchObject({
      ok: true,
      name: 'data.json',
      path: '/data/f1.json',
      size: 7,
      text: '{"a":1}',
      truncated: false,
    });
  });

  it('gives only the path for a binary file', async () => {
    const { ctx } = await toolContext();
    slack.getFileInfo.mockResolvedValue({ ...file, name: 'pic.png', mimetype: 'image/png' });
    files.downloadSlackFile.mockResolvedValue({ path: '/data/pic.png', size: 3, text: null });
    const out = await result(createSlackDownloadFileTool(ctx), { file_id: 'F1' });
    expect(out.path).toBe('/data/pic.png');
    expect(out).not.toHaveProperty('text');
  });

  it('cuts a long text preview and says so', async () => {
    const { ctx } = await toolContext();
    slack.getFileInfo.mockResolvedValue(file);
    files.downloadSlackFile.mockResolvedValue({
      path: '/p',
      size: 60_000,
      text: 'x'.repeat(60_000),
    });
    const out = await result(createSlackDownloadFileTool(ctx), { file_id: 'F1' });
    expect(out.text).toHaveLength(50_000);
    expect(out.truncated).toBe(true);
  });

  it('explains a download that is refused', async () => {
    const { ctx } = await toolContext();
    slack.getFileInfo.mockResolvedValue(file);
    files.downloadSlackFile.mockRejectedValue(new SlackFileError('the file is too large (30 MB)'));
    const out = await result(createSlackDownloadFileTool(ctx), { file_id: 'F1' });
    expect(out.error).toBe('Could not download the file: the file is too large (30 MB)');
  });

  it.each(['file_not_found', 'missing_scope'])('explains %s', async (code) => {
    const { ctx } = await toolContext();
    slack.getFileInfo.mockRejectedValue(new SlackApiError('files.info', code));
    const out = await result(createSlackDownloadFileTool(ctx), { file_id: 'F1' });
    expect(out.ok).toBe(false);
    expect(out.error).toContain(code);
    expect(out.error).toContain('files:read');
  });

  it('reports unexpected Slack errors as tool errors', async () => {
    const { ctx } = await toolContext();
    slack.getFileInfo.mockRejectedValue(new SlackApiError('files.info', 'ratelimited'));
    expect((await result(createSlackDownloadFileTool(ctx), { file_id: 'F1' })).ok).toBe(false);
  });
});

describe('read access follows the session owner, not the bot', () => {
  const PRIVATE = { name: 'leadership', isPrivate: true, isDirect: false };
  const readChannel = (ctx, channel) => result(createSlackReadChannelTool(ctx), { channel });
  const refused = (out) => {
    expect(out.ok).toBe(false);
    expect(out.error).toContain("I can't");
  };

  beforeEach(() => {
    slack.resolveChannelId.mockImplementation(async (_token, channel) => channel);
    slack.getChannelHistory.mockResolvedValue({ messages: [], hasMore: false, nextCursor: null });
    slack.getThreadReplies.mockResolvedValue([]);
  });

  it('reads the session’s own channel without asking Slack anything', async () => {
    const { ctx } = await toolContext();
    expect((await result(createSlackReadChannelTool(ctx))).ok).toBe(true);
    await readChannel(ctx, 'C1');
    expect(slack.getChannelInfo).not.toHaveBeenCalled();
  });

  it('reads public channels', async () => {
    const { ctx } = await toolContext();
    expect((await readChannel(ctx, 'C2')).ok).toBe(true);
  });

  it('refuses a private channel when the owner has no linked Slack account', async () => {
    const { ctx } = await toolContext();
    slack.getChannelInfo.mockResolvedValue(PRIVATE);
    refused(await readChannel(ctx, 'C2'));
    expect(slack.getChannelHistory).not.toHaveBeenCalled();
  });

  it('refuses a private channel the owner is not a member of', async () => {
    const { ctx, appId, userId } = await toolContext();
    await linkSlackUser(db, appId, 'UOWNER', userId);
    slack.getChannelInfo.mockResolvedValue(PRIVATE);
    slack.isChannelMember.mockResolvedValue(false);
    refused(await readChannel(ctx, 'C2'));
    expect(slack.isChannelMember).toHaveBeenCalledWith('xoxb-test', 'C2', 'UOWNER');
    expect(slack.getChannelHistory).not.toHaveBeenCalled();
  });

  it('reads a private channel the owner is a member of', async () => {
    const { ctx, appId, userId } = await toolContext();
    await linkSlackUser(db, appId, 'UOWNER', userId);
    slack.getChannelInfo.mockResolvedValue(PRIVATE);
    slack.isChannelMember.mockResolvedValue(true);
    expect((await readChannel(ctx, 'C2')).ok).toBe(true);
  });

  it('treats DMs and group DMs as private', async () => {
    const { ctx } = await toolContext();
    slack.getChannelInfo.mockResolvedValue({ name: null, isPrivate: false, isDirect: true });
    refused(await readChannel(ctx, 'D2'));
  });

  it('does not take another person’s Slack membership as the owner’s', async () => {
    const { ctx, appId } = await toolContext();
    const other = await insertUser(db);
    await linkSlackUser(db, appId, 'UOTHER', other);
    slack.getChannelInfo.mockResolvedValue(PRIVATE);
    slack.isChannelMember.mockImplementation(async (_t, _c, user) => user === 'UOTHER');
    refused(await readChannel(ctx, 'C2'));
  });

  it('fails closed when Slack cannot say what the channel is, or who is in it', async () => {
    const { ctx, appId, userId } = await toolContext();
    await linkSlackUser(db, appId, 'UOWNER', userId);
    slack.getChannelInfo.mockRejectedValue(new SlackApiError('conversations.info', 'ratelimited'));
    refused(await readChannel(ctx, 'C2'));
    slack.getChannelInfo.mockResolvedValue(PRIVATE);
    slack.isChannelMember.mockRejectedValue(new Error('boom'));
    refused(await readChannel(ctx, 'C2'));
    expect(slack.getChannelHistory).not.toHaveBeenCalled();
  });

  it('applies to a session that was not started from Slack, too', async () => {
    const { ctx } = await toolContext({ bound: false });
    slack.getChannelInfo.mockResolvedValue(PRIVATE);
    refused(await readChannel(ctx, 'C2'));
  });

  it('applies to threads read by link, channel or default', async () => {
    const { ctx } = await toolContext();
    slack.getChannelInfo.mockResolvedValue(PRIVATE);
    const tool = createSlackReadThreadTool(ctx);
    refused(await result(tool, { url: 'https://x.slack.com/archives/C9/p1793147747403329' }));
    refused(await result(tool, { channel: 'C9', thread_ts: '1.1' }));
    expect(slack.getThreadReplies).not.toHaveBeenCalled();
    expect((await result(tool)).ok).toBe(true); // its own thread
  });

  describe('files', () => {
    const file = {
      id: 'F1',
      name: 'a.txt',
      url: 'https://f/1',
      channel_ids: ['C9'],
      user_id: 'UUP',
    };
    const download = (ctx) => result(createSlackDownloadFileTool(ctx), { file_id: 'F1' });

    beforeEach(() => {
      files.downloadSlackFile.mockResolvedValue({ path: '/p', size: 1, text: 'hi' });
    });

    it('are refused when shared only in a private channel the owner is not in', async () => {
      const { ctx } = await toolContext();
      slack.getFileInfo.mockResolvedValue(file);
      slack.getChannelInfo.mockResolvedValue(PRIVATE);
      refused(await download(ctx));
      expect(files.downloadSlackFile).not.toHaveBeenCalled();
    });

    it('are refused when they were shared nowhere, unless the owner uploaded them', async () => {
      const { ctx, appId, userId } = await toolContext();
      slack.getFileInfo.mockResolvedValue({ ...file, channel_ids: [] });
      refused(await download(ctx));
      await linkSlackUser(db, appId, 'UUP', userId);
      expect((await download(ctx)).ok).toBe(true);
    });

    it('are allowed when any channel they were shared in is readable', async () => {
      const { ctx } = await toolContext();
      slack.getFileInfo.mockResolvedValue({ ...file, channel_ids: ['C9', 'C1'] });
      slack.getChannelInfo.mockResolvedValue(PRIVATE);
      expect((await download(ctx)).ok).toBe(true); // C1 is the session's own thread
    });

    it('are allowed from a public channel', async () => {
      const { ctx } = await toolContext();
      slack.getFileInfo.mockResolvedValue(file);
      expect((await download(ctx)).ok).toBe(true);
    });
  });
});

describe('ArchiveSession', () => {
  it('asks the sessions service to archive this session once its turn ends', async () => {
    const archiveAfterTurn = vi.fn();
    const tool = createArchiveSessionTool({
      app: { service: () => ({ archiveAfterTurn }) },
      session: { id: 42 },
    });
    const out = await result(tool);
    expect(archiveAfterTurn).toHaveBeenCalledWith(42);
    expect(out.ok).toBe(true);
  });

  it('fails without a session', async () => {
    const tool = createArchiveSessionTool({ app: { service: () => ({}) }, session: undefined });
    expect((await result(tool)).ok).toBe(false);
  });
});

describe('SessionCost', () => {
  const usage = {
    totals: { cost_usd: 1.2345, input_tokens: 1000, output_tokens: 200, total_tokens: 1200 },
    breakdown: [
      {
        agent_type: 'builder',
        model: 'haiku',
        agent_sdk: 'claude',
        cost_usd: 1.2,
        total_tokens: 1000,
      },
      {
        agent_type: 'reviewer',
        model: 'opus',
        agent_sdk: 'claude',
        cost_usd: 0.0345,
        total_tokens: 200,
      },
    ],
  };

  function costTool(session = { id: 5, user_id: 7 }) {
    const sessionUsage = vi.fn().mockResolvedValue(usage);
    const tool = createSessionCostTool({
      app: { service: () => ({ sessionUsage }) },
      session,
    });
    return { tool, sessionUsage };
  }

  it('reports what the session has cost so far, in total and per model', async () => {
    const { tool, sessionUsage } = costTool();
    const out = await result(tool);
    expect(sessionUsage).toHaveBeenCalledWith(5, { user: { id: 7 } });
    expect(out).toMatchObject({
      ok: true,
      total_cost_usd: 1.2345,
      total_cost: '$1.23',
      input_tokens: 1000,
      output_tokens: 200,
      total_tokens: 1200,
    });
    expect(out.breakdown.map((row) => [row.model, row.cost])).toEqual([
      ['haiku', '$1.20'],
      ['opus', '$0.0345'],
    ]);
  });

  it('shows small amounts with enough digits to mean something', async () => {
    const sessionUsage = vi.fn().mockResolvedValue({
      totals: { cost_usd: 0.0042, input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      breakdown: [],
    });
    const tool = createSessionCostTool({
      app: { service: () => ({ sessionUsage }) },
      session: { id: 1, user_id: 1 },
    });
    expect((await result(tool)).total_cost).toBe('$0.0042');
  });

  it('fails without a session', async () => {
    const { tool } = costTool(null);
    expect((await result(tool)).ok).toBe(false);
  });
});

describe('SystemStats', () => {
  const GB = 1024 ** 3;
  const info = {
    hostname: 'baguette-host',
    platform: 'linux',
    arch: 'x64',
    uptimeSeconds: 93_784,
    cpu: { count: 8, model: 'Test CPU', speedMhz: 3000 },
    loadAvg: [0.5, 1.25, 2],
    memory: { totalBytes: 16 * GB, freeBytes: 4 * GB, usedBytes: 12 * GB },
    disk: { path: '/data', totalBytes: 100 * GB, freeBytes: 40 * GB, availableBytes: 35 * GB },
  };

  beforeEach(() => system.getSystemInfo.mockReset().mockReturnValue(info));

  it('reports uptime, CPU, RAM and disk in plain units', async () => {
    const out = await result(createSystemStatsTool());
    expect(out).toMatchObject({
      ok: true,
      hostname: 'baguette-host',
      platform: 'linux x64',
      uptime: '1d 2h 3m',
      uptime_seconds: 93_784,
      memory: { total: '16.0 GB', used: '12.0 GB', free: '4.0 GB', used_percent: 75 },
      disk: {
        path: '/data',
        total: '100.0 GB',
        used: '60.0 GB',
        available: '35.0 GB',
        used_percent: 60,
      },
    });
    expect(out.cpu).toMatchObject({
      count: 8,
      model: 'Test CPU',
      load_average: { '1m': 0.5, '5m': 1.25, '15m': 2 },
    });
  });

  it('measures how busy the CPU is right now', async () => {
    const { cpu } = await result(createSystemStatsTool());
    expect(cpu.usage_percent).toBeGreaterThanOrEqual(0);
    expect(cpu.usage_percent).toBeLessThanOrEqual(100);
  });

  it('copes with an empty disk and with zero memory', async () => {
    system.getSystemInfo.mockReturnValue({
      ...info,
      memory: { totalBytes: 0, freeBytes: 0, usedBytes: 0 },
      disk: { path: '/', totalBytes: 0, freeBytes: 0, availableBytes: 0 },
    });
    const out = await result(createSystemStatsTool());
    expect(out.memory.used_percent).toBe(0);
    expect(out.disk.used_percent).toBe(0);
  });
});

describe('formatBytes / formatDuration', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [5 * 1024 ** 2, '5.0 MB'],
    [3.5 * 1024 ** 4, '3.5 TB'],
    [undefined, '0 B'],
  ])('formatBytes(%s) = %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it.each([
    [59, '0m'],
    [3_600, '1h 0m'],
    [93_784, '1d 2h 3m'],
    [172_800, '2d 0h 0m'],
    [-5, '0m'],
  ])('formatDuration(%s) = %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});
