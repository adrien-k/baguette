/**
 * Unit tests for the Slack Web API client.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SlackApiError,
  authTest,
  getPermalink,
  listChannels,
  postMessage,
  resolveChannelId,
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
});
