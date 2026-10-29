/**
 * The context block attached to every message the agent receives from Slack.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({
  getChannelHistory: vi.fn(),
  getChannelInfo: vi.fn(),
  getMessageFiles: vi.fn(),
  getThreadReplies: vi.fn(),
  getUserInfo: vi.fn(),
}));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

const files = vi.hoisted(() => ({ attachmentsContext: vi.fn() }));
vi.mock('../slack-files.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...files,
}));

import { createSlackContext, slackClock } from '../slack-context.js';
import { resetSlackUserCache } from '../slack-users.js';

const slackApp = { id: 1, bot_token: 'xoxb-1', bot_user_id: 'UBOT' };
const tagEvent = { type: 'app_mention', user: 'U1', channel: 'C1', ts: '5.5' };
const PEOPLE = { U1: 'Jan', U2: 'Eva', U3: 'Tom' };

const context = (event = tagEvent, threadTs = '5.5', text = 'fix it', options) =>
  createSlackContext().slackContext(slackApp, event, threadTs, text, options);

beforeEach(() => {
  resetSlackUserCache();
  slack.getUserInfo.mockReset().mockImplementation(async (_t, id) => ({ id, name: PEOPLE[id] }));
  slack.getChannelInfo
    .mockReset()
    .mockResolvedValue({ name: 'dev', isPrivate: false, topic: 'Engineering', purpose: null });
  slack.getThreadReplies.mockReset().mockResolvedValue([]);
  slack.getChannelHistory
    .mockReset()
    .mockResolvedValue({ messages: [], hasMore: false, nextCursor: null });
  slack.getMessageFiles.mockReset().mockResolvedValue([]);
  files.attachmentsContext.mockReset().mockResolvedValue('');
});

describe('slackClock', () => {
  it('formats a Slack ts as UTC date and time', () => {
    expect(slackClock('1793147747.403329')).toBe('2026-10-28 00:35');
  });

  it('is empty for something that is not a ts', () => {
    expect(slackClock('soon')).toBe('');
  });
});

describe('the security reminder', () => {
  it('comes with every message, tagged or not, first message or follow-up', async () => {
    for (const options of [undefined, { followUp: true }, { untagged: true }]) {
      expect(await context(tagEvent, '5.5', 'x', options)).toContain(
        'everyone in the company can read this Slack channel'
      );
    }
  });
});

describe('header', () => {
  it('names the sender, the channel with its topic, and the thread', async () => {
    const text = await context();
    expect(text).toContain('Slack context (provided automatically');
    expect(text).toContain('Message from Jan (<@U1>)\n');
    expect(text).toContain('Channel: #dev (C1) — topic: Engineering');
    expect(text).toContain('Thread: 5.5 (sent 1970-01-01 00:00 UTC)');
  });

  it('flags a message that was not addressed to the bot', async () => {
    expect(await context(tagEvent, '5.5', 'x', { untagged: true })).toContain(
      'Message from Jan (<@U1>) (not tagged to you)'
    );
  });

  it('mentions private channels and purpose', async () => {
    slack.getChannelInfo.mockResolvedValue({
      name: 'secret',
      isPrivate: true,
      topic: null,
      purpose: 'Launch planning',
    });
    expect(await context()).toContain(
      'Channel: #secret (C1) — private channel; purpose: Launch planning'
    );
  });

  it('asks Slack about a channel only once', async () => {
    const { slackContext } = createSlackContext();
    await slackContext(slackApp, tagEvent, '5.5', 'a');
    await slackContext(slackApp, tagEvent, '5.5', 'b');
    expect(slack.getChannelInfo).toHaveBeenCalledTimes(1);
  });

  it('falls back to ids when Slack lookups fail', async () => {
    slack.getUserInfo.mockRejectedValue(new Error('boom'));
    slack.getChannelInfo.mockRejectedValue(new Error('missing_scope'));
    const text = await context();
    expect(text).toContain('Message from <@U1>');
    expect(text).toContain('Channel: C1');
  });
});

describe('the thread', () => {
  const inThread = { ...tagEvent, ts: '2.0', thread_ts: '1.0' };

  it('gives a first message the whole thread, without bot replies or the tagging message', async () => {
    slack.getThreadReplies.mockResolvedValue([
      { ts: '1.0', user: 'U2', text: 'parent: checkout is broken', files: [] },
      { ts: '1.5', user: 'UBOT', text: 'On it' },
      { ts: '2.0', user: 'U1', text: '<@UBOT> take a look' },
    ]);
    const text = await context(inThread, '1.0', 'take a look');
    expect(text).toContain('The thread so far');
    expect(text).toMatch(/\] Eva \(<@U2>\): parent: checkout is broken/);
    expect(text).not.toContain('On it');
    expect(text).not.toContain('take a look\n');
  });

  it('on a follow-up only adds what was said since the bot last replied', async () => {
    slack.getThreadReplies.mockResolvedValue([
      { ts: '1.0', user: 'U2', text: 'old chatter' },
      { ts: '1.5', user: 'UBOT', text: 'done' },
      { ts: '1.8', user: 'U3', text: 'what about mobile?' },
      { ts: '2.0', user: 'U1', text: 'and tests?' },
    ]);
    const text = await context(inThread, '1.0', 'and tests?', { followUp: true });
    expect(text).toContain('since your last reply');
    expect(text).toMatch(/\] Tom \(<@U3>\): what about mobile\?/);
    expect(text).not.toContain('old chatter');
  });

  it('adds nothing when nobody else spoke', async () => {
    slack.getThreadReplies.mockResolvedValue([{ ts: '2.0', user: 'U1', text: 'hi' }]);
    expect(await context(inThread, '1.0', 'hi')).not.toContain('The thread so far');
  });

  it('does not read a thread for a top-level message', async () => {
    await context();
    expect(slack.getThreadReplies).not.toHaveBeenCalled();
  });

  it('keeps the latest 30 messages of a long thread and says how many were left out', async () => {
    slack.getThreadReplies.mockResolvedValue(
      Array.from({ length: 35 }, (_, i) => ({ ts: `${i + 1}.0`, user: 'U2', text: `m${i}` }))
    );
    const text = await context({ ...tagEvent, ts: '99.0', thread_ts: '1.0' }, '1.0');
    expect(text).toContain('(5 earlier messages omitted — use SlackReadThread)');
    expect(text).toContain('m34');
    expect(text).not.toContain(': m4\n');
  });

  it('clips very long messages and shows attachments by name', async () => {
    slack.getThreadReplies.mockResolvedValue([
      { ts: '1.0', user: 'U2', text: 'z'.repeat(2000) },
      { ts: '1.1', user: 'U3', text: '', files: [{ name: 'a.json' }, { name: 'b.csv' }] },
    ]);
    const text = await context({ ...tagEvent, ts: '3.0', thread_ts: '1.0' }, '1.0');
    expect(text).toContain(`${'z'.repeat(800)}…`);
    expect(text).toContain('[files: a.json, b.csv]');
  });

  it('is skipped quietly when Slack refuses', async () => {
    slack.getThreadReplies.mockRejectedValue(new Error('not_in_channel'));
    const text = await context(inThread, '1.0');
    expect(text).toContain('Message from Jan');
    expect(text).not.toContain('thread so far');
  });
});

describe('the channel before the thread', () => {
  it('includes the two latest human messages, flagged as maybe unrelated', async () => {
    slack.getChannelHistory.mockResolvedValue({
      messages: [
        { ts: '3.9', user: 'U3', text: 'too old', is_bot: false },
        { ts: '4.0', user: 'U3', text: 'did you see the alert?', is_bot: false },
        { ts: '4.1', user: 'U2', text: 'login is flaky again', is_bot: false },
        { ts: '4.2', user: 'UBOT', text: 'bot noise', is_bot: true },
        { ts: '5.5', user: 'U1', text: 'the tag itself', is_bot: false },
      ],
      hasMore: false,
      nextCursor: null,
    });
    const text = await context();
    expect(text).toMatch(
      /The last 2 messages in the channel before this thread \(they may or may not be related/
    );
    expect(text).toContain('did you see the alert?');
    expect(text).toContain('login is flaky again');
    expect(text).not.toContain('too old');
    expect(text).not.toContain('bot noise');
    expect(text).not.toContain('the tag itself');
    expect(slack.getChannelHistory.mock.calls[0][1]).toMatchObject({
      channel: 'C1',
      latest: '5.5',
    });
  });

  it('is singular for one message and absent for none', async () => {
    slack.getChannelHistory.mockResolvedValue({
      messages: [{ ts: '4.0', user: 'U3', text: 'only one', is_bot: false }],
      hasMore: false,
      nextCursor: null,
    });
    expect(await context()).toContain('The last 1 message in the channel');
    slack.getChannelHistory.mockResolvedValue({ messages: [], hasMore: false, nextCursor: null });
    expect(await context()).not.toContain('in the channel before');
  });

  it('is relative to the thread, also on a follow-up', async () => {
    await context({ ...tagEvent, ts: '9.0', thread_ts: '1.0' }, '1.0', 'x', { followUp: true });
    expect(slack.getChannelHistory.mock.calls[0][1]).toMatchObject({ latest: '1.0' });
  });

  it('is skipped quietly when Slack refuses', async () => {
    slack.getChannelHistory.mockRejectedValue(new Error('not_in_channel'));
    expect(await context()).toContain('Message from Jan');
  });
});

describe('linked Slack messages', () => {
  const link = 'https://acme.slack.com/archives/C9/p1793147747403329';

  it('reads the linked thread with names and times', async () => {
    slack.getThreadReplies.mockResolvedValue([{ ts: '7.0', user: 'U2', text: 'the bug is here' }]);
    const text = await context(tagEvent, '5.5', `look at ${link}`);
    expect(text).toContain(`Linked Slack thread (${link}):`);
    expect(text).toMatch(/\] Eva \(<@U2>\): the bug is here/);
    expect(slack.getThreadReplies.mock.calls[0][1]).toEqual({
      channel: 'C9',
      ts: '1793147747.403329',
    });
  });

  it('tells the agent how to recover when it cannot read the link', async () => {
    slack.getThreadReplies.mockRejectedValue(
      Object.assign(new Error('x'), { slackError: 'not_in_channel' })
    );
    const text = await context(tagEvent, '5.5', `look at ${link}`);
    expect(text).toContain('could not be read (not_in_channel)');
    expect(text).toContain('invite the bot');
  });

  it('adds nothing for text without Slack links', async () => {
    await context();
    expect(slack.getThreadReplies).not.toHaveBeenCalled();
  });
});

describe('attached files', () => {
  it('describes the files on the event', async () => {
    files.attachmentsContext.mockResolvedValue(
      '\n\nAttached files (downloaded for you):\n- a.json'
    );
    const event = {
      ...tagEvent,
      files: [{ id: 'F1', name: 'a.json', url_private_download: 'https://files/F1' }],
    };
    const text = await context(event);
    expect(text).toContain('Attached files (downloaded for you)');
    const [token, passed, dir] = files.attachmentsContext.mock.calls[0];
    expect(token).toBe('xoxb-1');
    expect(passed[0]).toMatchObject({ id: 'F1', url: 'https://files/F1' });
    expect(dir).toMatch(/slack-files[/\\]1[/\\]C1-5\.5$/);
    expect(slack.getMessageFiles).not.toHaveBeenCalled();
  });

  it('looks the files up when an app_mention event does not carry them', async () => {
    slack.getMessageFiles.mockResolvedValue([{ id: 'F2', name: 'b.txt' }]);
    await context({ ...tagEvent, ts: '6.0', thread_ts: '1.0' }, '1.0');
    expect(slack.getMessageFiles).toHaveBeenCalledWith('xoxb-1', {
      channel: 'C1',
      ts: '6.0',
      threadTs: '1.0',
    });
    expect(files.attachmentsContext.mock.calls[0][1]).toEqual([{ id: 'F2', name: 'b.txt' }]);
  });

  it('does not look anything up for ordinary messages, and survives a failed lookup', async () => {
    await context({ ...tagEvent, type: 'message' });
    expect(slack.getMessageFiles).not.toHaveBeenCalled();

    slack.getMessageFiles.mockRejectedValue(new Error('boom'));
    expect(await context()).toContain('Message from Jan');
  });
});

describe('filesOfEvent', () => {
  it('lets the bot see whether a tag carries files', async () => {
    slack.getMessageFiles.mockResolvedValue([{ id: 'F2', name: 'b.txt' }]);
    const { filesOfEvent } = createSlackContext();
    expect(await filesOfEvent(slackApp, tagEvent, '5.5')).toHaveLength(1);
    expect(await filesOfEvent(slackApp, { ...tagEvent, files: [] }, '5.5')).toEqual([]);
  });
});
