/**
 * Turning Slack's `<@U123>`-style markup into text the agent can understand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({ getUserInfo: vi.fn() }));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

import { resolveSlackText } from '../slack-mentions.js';
import { resetSlackUserCache } from '../slack-users.js';

const PEOPLE = {
  U1: { name: 'Honza', realName: 'Jan Havlena', username: 'honza' },
  U2: { name: 'Eva', realName: 'Eva Nováková', username: 'eva' },
};

const resolve = (text, options) => resolveSlackText('xoxb-1', text, options);

beforeEach(() => {
  resetSlackUserCache();
  slack.getUserInfo.mockReset().mockImplementation(async (_token, id) => {
    if (!PEOPLE[id]) throw new Error('user_not_found');
    return { id, ...PEOPLE[id] };
  });
});

describe('people', () => {
  it('names who a mentioned person is, so "ask <@U2>" makes sense', async () => {
    expect(await resolve('please ask <@U2> to review')).toBe(
      'please ask Eva Nováková (@eva · <@U2>) to review'
    );
  });

  it('resolves every mention, each person once', async () => {
    const text = await resolve('<@U1> and <@U2> and <@U1> again');
    expect(text).toBe(
      'Jan Havlena (@honza · <@U1>) and Eva Nováková (@eva · <@U2>) and Jan Havlena (@honza · <@U1>) again'
    );
    expect(slack.getUserInfo).toHaveBeenCalledTimes(2);
  });

  it('understands mentions that carry a label', async () => {
    expect(await resolve('<@U2|eva> look')).toBe('Eva Nováková (@eva · <@U2>) look');
  });

  it('keeps the mention for someone who cannot be looked up', async () => {
    expect(await resolve('ping <@U9>')).toBe('ping <@U9>');
  });

  it('calls the bot itself "you"', async () => {
    expect(await resolve('<@UBOT> and <@U1>', { botUserId: 'UBOT' })).toBe(
      'you and Jan Havlena (@honza · <@U1>)'
    );
    expect(slack.getUserInfo).not.toHaveBeenCalledWith('xoxb-1', 'UBOT');
  });
});

describe('channels, groups and special mentions', () => {
  it('writes channel names out', async () => {
    expect(await resolve('see <#C123|dev-team> first')).toBe('see #dev-team first');
  });

  it('writes user groups and @here / @channel / @everyone out', async () => {
    expect(await resolve('<!subteam^S1|@backend> and <!here> <!channel|channel> <!everyone>')).toBe(
      '@backend and @here @channel @everyone'
    );
  });

  it('uses the readable form of dates', async () => {
    expect(await resolve('due <!date^1700000000^{date}|Nov 14, 2023>')).toBe('due Nov 14, 2023');
  });
});

describe('links', () => {
  it('shows where a labelled link goes', async () => {
    expect(await resolve('read <https://x.dev/doc|the doc>')).toBe(
      'read the doc (https://x.dev/doc)'
    );
  });

  it('unwraps a bare link and a mailto', async () => {
    expect(await resolve('<https://x.dev> or <mailto:a@b.dev|mail us>')).toBe(
      'https://x.dev or mail us (mailto:a@b.dev)'
    );
  });
});

describe('everything else', () => {
  it('leaves plain text, other angle brackets and a missing text alone', async () => {
    expect(await resolve('a < b > c')).toBe('a < b > c');
    expect(await resolve(undefined)).toBe('');
    expect(slack.getUserInfo).not.toHaveBeenCalled();
  });

  it('falls back to bare mentions when names are unavailable (no users:read)', async () => {
    slack.getUserInfo.mockRejectedValue(
      Object.assign(new Error('x'), { slackError: 'missing_scope' })
    );
    expect(await resolve('ask <@U1>')).toBe('ask <@U1>');
  });
});
