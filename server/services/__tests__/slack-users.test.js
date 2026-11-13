/**
 * Slack user id → name lookups.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({ getUserInfo: vi.fn() }));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

import {
  resetSlackUserCache,
  slackUserLabel,
  slackUserName,
  slackUserProfile,
} from '../slack-users.js';

class MissingScope extends Error {
  slackError = 'missing_scope';
}

beforeEach(() => {
  resetSlackUserCache();
  slack.getUserInfo.mockReset().mockResolvedValue({ id: 'U1', name: 'Jan' });
});

describe('slackUserName', () => {
  it('looks a user up once and caches the answer', async () => {
    expect(await slackUserName('xoxb-1', 'U1')).toBe('Jan');
    expect(await slackUserName('xoxb-1', 'U1')).toBe('Jan');
    expect(slack.getUserInfo).toHaveBeenCalledTimes(1);
  });

  it('caches per token', async () => {
    await slackUserName('xoxb-1', 'U1');
    await slackUserName('xoxb-2', 'U1');
    expect(slack.getUserInfo).toHaveBeenCalledTimes(2);
  });

  it('refreshes after the cache expires', async () => {
    vi.useFakeTimers();
    try {
      await slackUserName('xoxb-1', 'U1');
      vi.advanceTimersByTime(31 * 60 * 1000);
      await slackUserName('xoxb-1', 'U1');
      expect(slack.getUserInfo).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null without calling Slack when there is no user id', async () => {
    expect(await slackUserName('xoxb-1', undefined)).toBeNull();
    expect(slack.getUserInfo).not.toHaveBeenCalled();
  });

  it('returns null — and remembers the failure — when the lookup fails', async () => {
    slack.getUserInfo.mockRejectedValue(new Error('user_not_found'));
    expect(await slackUserName('xoxb-1', 'U9')).toBeNull();
    expect(await slackUserName('xoxb-1', 'U9')).toBeNull();
    expect(slack.getUserInfo).toHaveBeenCalledTimes(1);
  });

  it('stops asking for a token that lacks the users:read scope', async () => {
    slack.getUserInfo.mockRejectedValue(new MissingScope('missing_scope'));
    expect(await slackUserName('xoxb-1', 'U1')).toBeNull();
    expect(await slackUserName('xoxb-1', 'U2')).toBeNull();
    expect(slack.getUserInfo).toHaveBeenCalledTimes(1);
  });
});

describe('slackUserLabel', () => {
  it('is "Name (<@id>)" when the name is known', async () => {
    expect(await slackUserLabel('xoxb-1', 'U1')).toBe('Jan (<@U1>)');
  });

  it('falls back to the mention, or "unknown"', async () => {
    slack.getUserInfo.mockRejectedValue(new Error('boom'));
    expect(await slackUserLabel('xoxb-1', 'U1')).toBe('<@U1>');
    expect(await slackUserLabel('xoxb-1', undefined)).toBe('unknown');
  });
});

describe('slackUserProfile', () => {
  it('returns the display name, real name and username', async () => {
    slack.getUserInfo.mockResolvedValue({
      id: 'U1',
      name: 'Honza',
      realName: 'Jan Havlena',
      username: 'honza',
    });
    expect(await slackUserProfile('xoxb-1', 'U1')).toEqual({
      name: 'Honza',
      realName: 'Jan Havlena',
      username: 'honza',
    });
  });

  it('is null when the user cannot be looked up', async () => {
    slack.getUserInfo.mockRejectedValue(new Error('user_not_found'));
    expect(await slackUserProfile('xoxb-1', 'U9')).toBeNull();
  });
});

describe('slackUserLabel with a real name and a handle', () => {
  it('shows the real name, the handle and the mention', async () => {
    slack.getUserInfo.mockResolvedValue({
      id: 'U1',
      name: 'Honza',
      realName: 'Jan Havlena',
      username: 'honza',
    });
    expect(await slackUserLabel('xoxb-1', 'U1')).toBe('Jan Havlena (@honza · <@U1>)');
  });

  it('does not repeat a handle that equals the name', async () => {
    slack.getUserInfo.mockResolvedValue({ id: 'U1', name: 'eva', username: 'eva' });
    expect(await slackUserLabel('xoxb-1', 'U1')).toBe('eva (<@U1>)');
  });

  it('uses the display name when there is no real name', async () => {
    slack.getUserInfo.mockResolvedValue({
      id: 'U1',
      name: 'Honza',
      realName: null,
      username: null,
    });
    expect(await slackUserLabel('xoxb-1', 'U1')).toBe('Honza (<@U1>)');
  });
});
