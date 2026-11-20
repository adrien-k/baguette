/**
 * Posting replies as the bot: failures are reported to the caller, never thrown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({ postMarkdown: vi.fn() }));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

import { sayMarkdown } from '../slack-replies.js';

const slackApp = { bot_token: 'xoxb-test' };

beforeEach(() => slack.postMarkdown.mockReset());

describe('sayMarkdown', () => {
  it('says whether the reply was posted', async () => {
    slack.postMarkdown.mockResolvedValueOnce({});
    expect(await sayMarkdown(slackApp, 'C1', '1.1', '**hi**')).toBe(true);
    expect(slack.postMarkdown.mock.calls[0][1]).toMatchObject({
      channel: 'C1',
      threadTs: '1.1',
      markdown: '**hi**',
      fallbackText: '*hi*',
    });
  });

  it('returns false instead of throwing when Slack refuses', async () => {
    slack.postMarkdown.mockRejectedValueOnce(new Error('ratelimited'));
    expect(await sayMarkdown(slackApp, 'C1', '1.1', 'hi')).toBe(false);
  });
});
