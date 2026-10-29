/**
 * Unit tests for the Slack Web API client.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SlackApiError,
  authTest,
  buildAuthorizeUrl,
  deleteMessage,
  getChannelHistory,
  getChannelInfo,
  getFileInfo,
  getMessageFiles,
  getPermalink,
  getThreadReplies,
  getUserInfo,
  isChannelMember,
  listChannels,
  normalizeSlackFile,
  oauthAccess,
  postBlocks,
  postEphemeral,
  postMarkdown,
  setAgentSessionStatus,
  setThreadStatus,
  postMessage,
  resolveChannelId,
  slackEventsUrl,
  slackRedirectUri,
  updateMessage,
} from '../slack.js';

const TOKEN = 'xoxb-test-token';

/** Queues Slack JSON responses in call order. */
function mockSlack(...payloads) {
  const fetchMock = vi.fn();
  for (const payload of payloads) {
    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => payload });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastBody(fetchMock, index = 0) {
  return JSON.parse(fetchMock.mock.calls[index][1].body);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('request handling', () => {
  it('sends the bot token as a bearer header', async () => {
    const fetchMock = mockSlack({ ok: true, channel: 'C1', ts: '1.1' });
    await postMessage(TOKEN, { channel: 'C1', text: 'hi' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('passes an abort signal so a stalled call cannot hang forever', async () => {
    const fetchMock = mockSlack({ ok: true, channel: 'C1', ts: '1.1' });
    await postMessage(TOKEN, { channel: 'C1', text: 'hi' });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('fails with a clear error when Slack does not answer in time', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => AbortSignal.abort(new DOMException('x', 'TimeoutError')));
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, { signal }) => Promise.reject(signal.reason))
    );
    await expect(postMessage(TOKEN, { channel: 'C1', text: 'hi' })).rejects.toThrow(
      /chat\.postMessage timed out after 15s/
    );
    timeout.mockRestore();
  });

  it('throws SlackApiError with a hint when Slack returns ok:false', async () => {
    mockSlack({ ok: false, error: 'not_in_channel' });
    const rejection = await postMessage(TOKEN, { channel: 'C1', text: 'hi' }).catch((e) => e);
    expect(rejection).toBeInstanceOf(SlackApiError);
    expect(rejection.slackError).toBe('not_in_channel');
    expect(rejection.message).toMatch(/not_in_channel.*invite/is);
  });

  it('throws without calling Slack when no token is configured', async () => {
    const fetchMock = mockSlack();
    await expect(postMessage(null, { channel: 'C1', text: 'hi' })).rejects.toThrow(/not_authed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a non-JSON response rather than failing obscurely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      })
    );
    await expect(postMessage(TOKEN, { channel: 'C1', text: 'hi' })).rejects.toThrow(
      /non-JSON response \(HTTP 502\)/
    );
  });
});

describe('postMessage', () => {
  it('posts the message and returns the channel and ts', async () => {
    const fetchMock = mockSlack({ ok: true, channel: 'C1', ts: '111.2' });
    const result = await postMessage(TOKEN, { channel: 'C1', text: 'hello' });

    expect(result).toEqual({ channel: 'C1', ts: '111.2' });
    expect(lastBody(fetchMock)).toMatchObject({ channel: 'C1', text: 'hello', unfurl_links: true });
  });
});

describe('resolveChannelId', () => {
  it('passes encoded channel ids through without an API call', async () => {
    const fetchMock = mockSlack();
    expect(await resolveChannelId(TOKEN, 'C0123ABCD')).toBe('C0123ABCD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('looks up #name and returns the id', async () => {
    mockSlack({ ok: true, channels: [{ id: 'C999', name: 'engineering' }] });
    expect(await resolveChannelId(TOKEN, '#engineering')).toBe('C999');
  });

  it('memoises the lookup for the same name', async () => {
    const fetchMock = mockSlack({ ok: true, channels: [{ id: 'C777', name: 'cached-chan' }] });
    await resolveChannelId(TOKEN, '#cached-chan');
    await resolveChannelId(TOKEN, 'cached-chan');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lists the reachable channels when the name is unknown', async () => {
    mockSlack({ ok: true, channels: [{ id: 'C1', name: 'general' }] });
    await expect(resolveChannelId(TOKEN, '#nope')).rejects.toThrow(/#general/);
  });

  it('rejects an empty channel', async () => {
    await expect(resolveChannelId(TOKEN, '  ')).rejects.toThrow(/channel is required/);
  });
});

describe('other methods', () => {
  it('authTest maps the identity fields', async () => {
    mockSlack({ ok: true, team: 'Acme', team_id: 'T1', user: 'baguette', user_id: 'U1' });
    expect(await authTest(TOKEN)).toMatchObject({ team: 'Acme', user: 'baguette', userId: 'U1' });
  });

  it('getPermalink issues a GET with the message ts', async () => {
    const fetchMock = mockSlack({ ok: true, permalink: 'https://slack.com/archives/C1/p1' });
    expect(await getPermalink(TOKEN, { channel: 'C1', ts: '111.2' })).toBe(
      'https://slack.com/archives/C1/p1'
    );
    expect(fetchMock.mock.calls[0][0]).toContain('message_ts=111.2');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('listChannels normalises membership flags', async () => {
    mockSlack({
      ok: true,
      channels: [
        { id: 'C1', name: 'general' },
        { id: 'C2', name: 'secret', is_private: true, is_member: true },
      ],
    });
    expect(await listChannels(TOKEN)).toEqual([
      { id: 'C1', name: 'general', is_private: false, is_member: false },
      { id: 'C2', name: 'secret', is_private: true, is_member: true },
    ]);
  });

  it('listChannels paginates until next_cursor is empty', async () => {
    const fetchMock = mockSlack(
      {
        ok: true,
        channels: [{ id: 'C1', name: 'first-page' }],
        response_metadata: { next_cursor: 'page-2' },
      },
      {
        ok: true,
        channels: [{ id: 'C2', name: 'second-page' }],
        response_metadata: { next_cursor: '' },
      }
    );
    expect(await listChannels(TOKEN)).toEqual([
      { id: 'C1', name: 'first-page', is_private: false, is_member: false },
      { id: 'C2', name: 'second-page', is_private: false, is_member: false },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('cursor=page-2');
  });
});

describe('messages in threads, edits and deletes', () => {
  it('postMessage replies in a thread when given a threadTs', async () => {
    const fetchMock = mockSlack({ ok: true, channel: 'C1', ts: '2.2' });
    await postMessage(TOKEN, { channel: 'C1', text: 'hi', threadTs: '1.1' });
    expect(lastBody(fetchMock)).toMatchObject({ channel: 'C1', text: 'hi', thread_ts: '1.1' });
  });

  it('postMessage leaves thread_ts out when not replying', async () => {
    const fetchMock = mockSlack({ ok: true, channel: 'C1', ts: '2.2' });
    await postMessage(TOKEN, { channel: 'C1', text: 'hi' });
    expect(lastBody(fetchMock)).not.toHaveProperty('thread_ts');
  });

  it('updateMessage edits by ts, optionally replacing blocks', async () => {
    const fetchMock = mockSlack({ ok: true }, { ok: true });
    await updateMessage(TOKEN, { channel: 'C1', ts: '1.1', text: 'new' });
    await updateMessage(TOKEN, { channel: 'C1', ts: '1.1', text: 'new', blocks: [] });
    expect(fetchMock.mock.calls[0][0]).toMatch(/chat\.update$/);
    expect(lastBody(fetchMock, 0)).toEqual({ channel: 'C1', ts: '1.1', text: 'new' });
    expect(lastBody(fetchMock, 1).blocks).toEqual([]);
  });

  it('deleteMessage removes a message', async () => {
    const fetchMock = mockSlack({ ok: true });
    await deleteMessage(TOKEN, { channel: 'C1', ts: '1.1' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/chat\.delete$/);
    expect(lastBody(fetchMock)).toEqual({ channel: 'C1', ts: '1.1' });
  });

  it('postEphemeral targets one user, optionally within a thread', async () => {
    const fetchMock = mockSlack({ ok: true }, { ok: true });
    await postEphemeral(TOKEN, { channel: 'C1', user: 'U1', text: 'psst' });
    await postEphemeral(TOKEN, { channel: 'C1', user: 'U1', text: 'psst', threadTs: '1.1' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/chat\.postEphemeral$/);
    expect(lastBody(fetchMock, 0)).not.toHaveProperty('thread_ts');
    expect(lastBody(fetchMock, 1).thread_ts).toBe('1.1');
  });

  it('postBlocks sends Block Kit blocks with a text fallback', async () => {
    const fetchMock = mockSlack({ ok: true, channel: 'C1', ts: '3.3' });
    const out = await postBlocks(TOKEN, {
      channel: 'C1',
      text: 'pick',
      blocks: [{ type: 'section' }],
      threadTs: '1.1',
    });
    expect(out).toEqual({ channel: 'C1', ts: '3.3' });
    expect(lastBody(fetchMock)).toMatchObject({
      text: 'pick',
      blocks: [{ type: 'section' }],
      thread_ts: '1.1',
    });
  });
});

describe('setThreadStatus', () => {
  it('sets the animated status line under a thread, and clears it with an empty one', async () => {
    const fetchMock = mockSlack({ ok: true }, { ok: true });
    await setThreadStatus(TOKEN, { channel: 'C1', threadTs: '1.1', status: 'is cooking… 🥖' });
    await setThreadStatus(TOKEN, { channel: 'C1', threadTs: '1.1', status: '' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/assistant\.threads\.setStatus$/);
    expect(lastBody(fetchMock, 0)).toEqual({
      channel_id: 'C1',
      thread_ts: '1.1',
      status: 'is cooking… 🥖',
    });
    expect(lastBody(fetchMock, 1).status).toBe('');
  });
});

describe('setAgentSessionStatus', () => {
  it('sets the agent status of a thread', async () => {
    const fetchMock = mockSlack({ ok: true }, { ok: true });
    await setAgentSessionStatus(TOKEN, { channel: 'C1', threadTs: '1.1', status: 'processing' });
    await setAgentSessionStatus(TOKEN, { channel: 'C1', threadTs: '1.1', status: 'active' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/agents\.sessions\.setStatus$/);
    expect(lastBody(fetchMock, 0)).toEqual({
      channel_id: 'C1',
      thread_ts: '1.1',
      status: 'processing',
    });
    expect(lastBody(fetchMock, 1).status).toBe('active');
  });

  it('reports Slack’s refusal', async () => {
    mockSlack({ ok: false, error: 'feature_disabled' });
    await expect(
      setAgentSessionStatus(TOKEN, { channel: 'C1', threadTs: '1.1', status: 'processing' })
    ).rejects.toMatchObject({ slackError: 'feature_disabled' });
  });
});

describe('postMarkdown', () => {
  it('sends the markdown as a native markdown block', async () => {
    const fetchMock = mockSlack({ ok: true, channel: 'C1', ts: '4.4' });
    await postMarkdown(TOKEN, {
      channel: 'C1',
      markdown: '# Hi',
      fallbackText: '*Hi*',
      threadTs: '1.1',
    });
    expect(lastBody(fetchMock)).toMatchObject({
      text: '*Hi*',
      blocks: [{ type: 'markdown', text: '# Hi' }],
      thread_ts: '1.1',
    });
  });

  it('cuts text at the 12,000 character block limit', async () => {
    const fetchMock = mockSlack({ ok: true, channel: 'C1', ts: '4.4' });
    await postMarkdown(TOKEN, { channel: 'C1', markdown: 'x'.repeat(13000), fallbackText: 'x' });
    expect(lastBody(fetchMock).blocks[0].text).toHaveLength(12000);
  });

  it('falls back to a plain message when Slack rejects the blocks', async () => {
    const fetchMock = mockSlack(
      { ok: false, error: 'invalid_blocks' },
      { ok: true, channel: 'C1', ts: '5.5' }
    );
    const out = await postMarkdown(TOKEN, {
      channel: 'C1',
      markdown: '# Hi',
      fallbackText: '*Hi*',
    });
    expect(out).toEqual({ channel: 'C1', ts: '5.5' });
    expect(lastBody(fetchMock, 1)).toMatchObject({ text: '*Hi*' });
    expect(lastBody(fetchMock, 1)).not.toHaveProperty('blocks');
  });

  it('does not hide other errors', async () => {
    mockSlack({ ok: false, error: 'channel_not_found' });
    await expect(
      postMarkdown(TOKEN, { channel: 'C1', markdown: 'x', fallbackText: 'x' })
    ).rejects.toMatchObject({ slackError: 'channel_not_found' });
  });
});

describe('reading', () => {
  const file = {
    id: 'F1',
    name: 'a.json',
    mimetype: 'application/json',
    filetype: 'json',
    size: 5,
    url_private_download: 'https://files/dl',
    url_private: 'https://files/p',
  };

  it('normalizeSlackFile keeps what we use and prefers the download link', () => {
    expect(normalizeSlackFile(file)).toEqual({
      id: 'F1',
      name: 'a.json',
      mimetype: 'application/json',
      filetype: 'json',
      size: 5,
      url: 'https://files/dl',
      channel_ids: [],
      user_id: null,
    });
    expect(normalizeSlackFile({ id: 'F2', title: 'Notes' })).toMatchObject({
      name: 'Notes',
      url: null,
      mimetype: null,
    });
    expect(normalizeSlackFile({ id: 'F3' }).name).toBe('file');
  });

  it('normalizeSlackFile lists every conversation the file was shared in, and the uploader', () => {
    expect(
      normalizeSlackFile({
        id: 'F4',
        user: 'UUP',
        channels: ['C1'],
        groups: ['G1'],
        ims: ['D1'],
        shares: { public: { C1: [], C2: [] }, private: { G3: [] } },
      })
    ).toMatchObject({ user_id: 'UUP', channel_ids: ['C1', 'G1', 'D1', 'C2', 'G3'] });
  });

  it('getThreadReplies maps messages, bots and files', async () => {
    const fetchMock = mockSlack({
      ok: true,
      messages: [
        { ts: '1.0', user: 'U1', text: 'hi', files: [file] },
        { ts: '1.1', user: 'UB', bot_id: 'B1' },
      ],
    });
    const out = await getThreadReplies(TOKEN, { channel: 'C1', ts: '1.0' });
    expect(fetchMock.mock.calls[0][0]).toContain('conversations.replies');
    expect(out).toEqual([
      { ts: '1.0', user: 'U1', text: 'hi', is_bot: false, files: [normalizeSlackFile(file)] },
      { ts: '1.1', user: 'UB', text: '', is_bot: true, files: [] },
    ]);
  });

  it('getChannelHistory returns a page oldest-first with its cursor', async () => {
    const fetchMock = mockSlack({
      ok: true,
      has_more: true,
      response_metadata: { next_cursor: 'abc' },
      messages: [
        { ts: '3.0', user: 'U1', text: 'newest' },
        { ts: '2.0', user: 'U1', text: 'thread starter', thread_ts: '2.0', reply_count: 3 },
        { ts: '1.5', user: 'U1', text: 'a reply', thread_ts: '1.0' },
      ],
    });
    const out = await getChannelHistory(TOKEN, {
      channel: 'C1',
      limit: 3,
      cursor: 'x',
      latest: '9.0',
    });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('conversations.history');
    expect(url).toContain('limit=3');
    expect(url).toContain('cursor=x');
    expect(url).toContain('latest=9.0');
    expect(out.messages.map((m) => m.ts)).toEqual(['1.5', '2.0', '3.0']);
    expect(out.messages[0].thread_ts).toBe('1.0');
    expect(out.messages[1]).toMatchObject({ reply_count: 3, thread_ts: undefined });
    expect(out).toMatchObject({ hasMore: true, nextCursor: 'abc' });
  });

  it('getChannelHistory reports the last page', async () => {
    mockSlack({ ok: true, messages: [], has_more: false, response_metadata: { next_cursor: '' } });
    expect(await getChannelHistory(TOKEN, { channel: 'C1' })).toEqual({
      messages: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('getChannelInfo returns name, privacy, topic and purpose', async () => {
    mockSlack({
      ok: true,
      channel: { name: 'dev', is_private: true, topic: { value: 'T' }, purpose: { value: '' } },
    });
    expect(await getChannelInfo(TOKEN, 'C1')).toEqual({
      name: 'dev',
      isPrivate: true,
      isDirect: false,
      topic: 'T',
      purpose: null,
    });
  });

  it('getChannelInfo flags direct and group messages', async () => {
    mockSlack({ ok: true, channel: { is_im: true } }, { ok: true, channel: { is_mpim: true } });
    expect((await getChannelInfo(TOKEN, 'D1')).isDirect).toBe(true);
    expect((await getChannelInfo(TOKEN, 'G1')).isDirect).toBe(true);
  });

  describe('isChannelMember', () => {
    it('finds a member on the first page', async () => {
      mockSlack({ ok: true, members: ['U1', 'U2'] });
      expect(await isChannelMember(TOKEN, 'C1', 'U2')).toBe(true);
    });

    it('follows the cursor to later pages', async () => {
      const fetchMock = mockSlack(
        { ok: true, members: ['U1'], response_metadata: { next_cursor: 'n1' } },
        { ok: true, members: ['U2'] }
      );
      expect(await isChannelMember(TOKEN, 'C1', 'U2')).toBe(true);
      expect(fetchMock.mock.calls[1][0]).toContain('cursor=n1');
    });

    it('is false for a non-member, and does not scan forever', async () => {
      mockSlack({ ok: true, members: ['U1'] });
      expect(await isChannelMember(TOKEN, 'C1', 'U9')).toBe(false);

      const endless = vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ ok: true, members: ['U1'], response_metadata: { next_cursor: 'n' } }),
      });
      vi.stubGlobal('fetch', endless);
      expect(await isChannelMember(TOKEN, 'C1', 'U9')).toBe(false);
      expect(endless).toHaveBeenCalledTimes(20);
    });

    it('throws when Slack refuses, so callers can fail closed', async () => {
      mockSlack({ ok: false, error: 'channel_not_found' });
      await expect(isChannelMember(TOKEN, 'C1', 'U1')).rejects.toThrow('channel_not_found');
    });
  });

  it('getUserInfo prefers the display name', async () => {
    mockSlack(
      {
        ok: true,
        user: { name: 'jan', real_name: 'Jan H', profile: { display_name: 'Honza', title: 'Dev' } },
      },
      { ok: true, user: { name: 'bot1', is_bot: true, profile: {} } }
    );
    expect(await getUserInfo(TOKEN, 'U1')).toMatchObject({
      id: 'U1',
      name: 'Honza',
      realName: 'Jan H',
      title: 'Dev',
    });
    expect(await getUserInfo(TOKEN, 'U2')).toMatchObject({ name: 'bot1', isBot: true });
  });

  it('getFileInfo returns the normalized file', async () => {
    const fetchMock = mockSlack({ ok: true, file });
    expect(await getFileInfo(TOKEN, 'F1')).toMatchObject({ id: 'F1', url: 'https://files/dl' });
    expect(fetchMock.mock.calls[0][0]).toContain('file=F1');
  });

  it('getMessageFiles reads a top-level message from the channel history', async () => {
    const fetchMock = mockSlack({ ok: true, messages: [{ ts: '5.5', files: [file] }] });
    expect(await getMessageFiles(TOKEN, { channel: 'C1', ts: '5.5' })).toHaveLength(1);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('conversations.history');
    expect(url).toContain('inclusive=true');
  });

  it('getMessageFiles reads a reply from its thread', async () => {
    const fetchMock = mockSlack({ ok: true, messages: [{ ts: '6.0', files: [file] }] });
    expect(
      await getMessageFiles(TOKEN, { channel: 'C1', ts: '6.0', threadTs: '5.5' })
    ).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('conversations.replies');
  });

  it('getMessageFiles is empty when the message is not found or has no files', async () => {
    mockSlack({ ok: true, messages: [] }, { ok: true, messages: [{ ts: '5.5' }] });
    expect(await getMessageFiles(TOKEN, { channel: 'C1', ts: '5.5' })).toEqual([]);
    expect(await getMessageFiles(TOKEN, { channel: 'C1', ts: '5.5' })).toEqual([]);
  });
});

describe('installing the app', () => {
  it('buildAuthorizeUrl asks for every scope the bot needs', () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: '1.2', redirectUri: 'https://x/cb', state: 'st' })
    );
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('1.2');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/cb');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('scope').split(',')).toEqual(
      expect.arrayContaining([
        'app_mentions:read',
        'chat:write',
        'assistant:write',
        'channels:history',
        'groups:history',
        'users:read',
        'files:read',
      ])
    );
  });

  it('oauthAccess exchanges the code for a token and the workspace identity', async () => {
    const fetchMock = mockSlack({
      ok: true,
      access_token: 'xoxb-new',
      bot_user_id: 'UBOT',
      app_id: 'A1',
      team: { id: 'T1', name: 'Futrou' },
    });
    const out = await oauthAccess({
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'c',
      redirectUri: 'https://x/cb',
    });
    expect(out).toEqual({
      botToken: 'xoxb-new',
      botUserId: 'UBOT',
      apiAppId: 'A1',
      teamId: 'T1',
      teamName: 'Futrou',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/oauth\.v2\.access$/);
    expect(String(init.body)).toContain('code=c');
    expect(String(init.body)).toContain('client_secret=sec');
  });

  it('oauthAccess reports Slack’s error, and a non-JSON answer', async () => {
    mockSlack({ ok: false, error: 'invalid_code' });
    await expect(
      oauthAccess({ clientId: 'a', clientSecret: 'b', code: 'c', redirectUri: 'd' })
    ).rejects.toMatchObject({
      slackError: 'invalid_code',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 502,
        json: async () => {
          throw new Error('html');
        },
      })
    );
    await expect(
      oauthAccess({ clientId: 'a', clientSecret: 'b', code: 'c', redirectUri: 'd' })
    ).rejects.toMatchObject({
      slackError: 'http_502',
    });
  });

  it('the events and redirect URLs point at this server’s /api/slack routes', () => {
    expect(slackEventsUrl()).toMatch(/\/api\/slack\/events$/);
    expect(slackRedirectUri()).toMatch(/\/api\/slack\/oauth\/callback$/);
  });
});
