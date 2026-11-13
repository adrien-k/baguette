/**
 * Pure Slack text helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  extractAssistantText,
  isStopRequest,
  mentionsWord,
  parseSlackOptions,
  slackBranchName,
  slackLinksIn,
  slackSessionTitle,
  stripBotMention,
  toSlackMrkdwn,
} from '../slack-text.js';

describe('mentionsWord', () => {
  it('matches whole words, case-insensitively', () => {
    expect(mentionsWord('hey Baguette, help', 'baguette')).toBe(true);
    expect(mentionsWord('use pi for it', 'pi')).toBe(true);
    expect(mentionsWord('try composer 2.5', '2.5')).toBe(true);
  });

  it('does not match inside another word', () => {
    expect(mentionsWord('the pipeline', 'pi')).toBe(false);
    expect(mentionsWord('baguettes', 'baguette')).toBe(false);
  });

  it('treats regex characters literally and ignores empty words', () => {
    expect(mentionsWord('a+b', 'a+b')).toBe(true);
    expect(mentionsWord('axb', 'a.b')).toBe(false);
    expect(mentionsWord('anything', '')).toBe(false);
    expect(mentionsWord('anything', null)).toBe(false);
  });
});

describe('stripBotMention', () => {
  it('removes the bot mention only', () => {
    expect(stripBotMention('<@UBOT> fix <@UOTHER> bug', 'UBOT')).toBe('fix <@UOTHER> bug');
  });

  it('removes a mention that carries a label, and every occurrence', () => {
    expect(stripBotMention('<@UBOT|baguette> hi <@UBOT>', 'UBOT')).toBe('hi');
  });

  it('copes with missing text', () => {
    expect(stripBotMention(undefined, 'UBOT')).toBe('');
  });
});

describe('parseSlackOptions', () => {
  it('extracts repo and branch options, in brackets or not', () => {
    expect(parseSlackOptions('fix login [repo=acme/web branch=dev]')).toEqual({
      prompt: 'fix login',
      repo: 'acme/web',
      branch: 'dev',
    });
    expect(parseSlackOptions('repo=acme/web fix login')).toMatchObject({
      prompt: 'fix login',
      repo: 'acme/web',
    });
  });

  it('strips the angle brackets Slack puts around links', () => {
    expect(parseSlackOptions('go repo=<acme/web>').repo).toBe('acme/web');
  });

  it('returns nulls when there are no options, and tolerates missing text', () => {
    expect(parseSlackOptions('just do it')).toEqual({
      prompt: 'just do it',
      repo: null,
      branch: null,
    });
    expect(parseSlackOptions(undefined)).toEqual({ prompt: '', repo: null, branch: null });
  });
});

describe('extractAssistantText', () => {
  it('joins the text blocks of a stored row and ignores thinking and tool calls', () => {
    const json = JSON.stringify({
      type: 'assistant',
      blocks: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'Done.' },
        { type: 'tool_use', name: 'Bash' },
        { type: 'text', text: 'Bye.' },
      ],
    });
    expect(extractAssistantText(json)).toBe('Done.\nBye.');
  });

  it('reads SDK-shaped payloads and plain string content', () => {
    expect(
      extractAssistantText(JSON.stringify({ message: { content: [{ type: 'text', text: 'Hi' }] } }))
    ).toBe('Hi');
    expect(extractAssistantText(JSON.stringify({ content: '  spaced  ' }))).toBe('spaced');
  });

  it.each([
    ['tool-only rows', JSON.stringify({ blocks: [{ type: 'tool_use', name: 'Bash' }] })],
    ['invalid JSON', '{nope'],
    ['unexpected content', JSON.stringify({ blocks: 5 })],
    ['text blocks without text', JSON.stringify({ blocks: [{ type: 'text' }] })],
  ])('is empty for %s', (_name, json) => {
    expect(extractAssistantText(json)).toBe('');
  });
});

describe('toSlackMrkdwn', () => {
  it('converts headings, bold and links', () => {
    expect(toSlackMrkdwn('## Title\n**bold** [site](https://x.dev)')).toBe(
      '*Title*\n*bold* <https://x.dev|site>'
    );
  });

  it('leaves non-http links alone', () => {
    expect(toSlackMrkdwn('[x](javascript:alert)')).toBe('[x](javascript:alert)');
  });

  it('truncates very long replies and says so', () => {
    const text = toSlackMrkdwn('a'.repeat(5000));
    expect(text.length).toBeLessThan(3700);
    expect(text).toContain('truncated');
  });

  it('copes with missing text', () => {
    expect(toSlackMrkdwn(undefined)).toBe('');
  });
});

describe('slackLinksIn', () => {
  const link = (id) => `https://acme.slack.com/archives/C0123ABCD/p17931477474033${id}`;

  it('finds bare links and links inside <url|label>', () => {
    expect(slackLinksIn(`see ${link('29')} and <${link('30')}|this thread>`)).toEqual([
      link('29'),
      link('30'),
    ]);
  });

  it('drops duplicates and keeps at most three', () => {
    expect(slackLinksIn(`${link('11')} ${link('11')}`)).toEqual([link('11')]);
    expect(slackLinksIn([11, 12, 13, 14].map(link).join(' '))).toHaveLength(3);
  });

  it('ignores other urls and missing text', () => {
    expect(slackLinksIn('https://example.com/archives/C1/p1793147747403329')).toEqual([]);
    expect(slackLinksIn(undefined)).toEqual([]);
  });
});

describe('isStopRequest', () => {
  it.each([
    'stop',
    'Stop!',
    'stop now',
    'please stop immediately',
    'immediately stop',
    'cancel the work',
    'abort',
    'halt everything right now',
    'stop the session',
    'stop it, thanks',
    'baguette stop',
  ])('treats "%s" as a request to stop', (text) => {
    expect(isStopRequest(text)).toBe(true);
  });

  it.each([
    'stop using var in this file',
    'cancel the subscription handling and add retries',
    'do not stop until the tests pass',
    'continue',
    'fix the bug',
    'unstoppable',
    'stop one two three four five six seven',
    '',
    undefined,
  ])('does not treat "%s" as one', (text) => {
    expect(isStopRequest(text)).toBe(false);
  });
});

describe('buildUserTurnMessageJson', () => {
  it('stays the plain user turn without metadata', async () => {
    const { buildUserTurnMessageJson } = await import('../feathers/message-create-fields.js');
    expect(JSON.parse(buildUserTurnMessageJson('hello'))).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' },
    });
  });

  it('carries metadata that says where the message came from', async () => {
    const { buildUserTurnMessageJson } = await import('../feathers/message-create-fields.js');
    const meta = { source: 'slack', slack: { user_id: 'U1' } };
    expect(JSON.parse(buildUserTurnMessageJson('hello', meta))).toEqual({
      type: 'user',
      source: 'slack',
      slack: { user_id: 'U1' },
      message: { role: 'user', content: 'hello' },
    });
  });

  it('never lets metadata replace the text the agent receives', async () => {
    const { buildUserTurnMessageJson } = await import('../feathers/message-create-fields.js');
    const parsed = JSON.parse(buildUserTurnMessageJson('real', { message: { content: 'fake' } }));
    expect(parsed.message.content).toBe('real');
  });
});

describe('slackSessionTitle', () => {
  it('uses the first line, tidied', () => {
    expect(slackSessionTitle('fix the flaky login test\nmore details')).toBe(
      'Fix the flaky login test'
    );
    expect(slackSessionTitle('  *please*   look at `auth.js`  ')).toBe('Please look at auth.js');
  });

  it('skips empty lines', () => {
    expect(slackSessionTitle('\n\n  add retries')).toBe('Add retries');
  });

  it('cuts a long first line at a word and ends it with an ellipsis', () => {
    const title = slackSessionTitle('word '.repeat(40));
    expect(title.length).toBeLessThanOrEqual(70);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it('is null when there is nothing to title', () => {
    expect(slackSessionTitle('')).toBeNull();
    expect(slackSessionTitle('  \n  ')).toBeNull();
    expect(slackSessionTitle('***')).toBeNull();
    expect(slackSessionTitle(undefined)).toBeNull();
  });
});

describe('slackBranchName', () => {
  it('makes a git-friendly slug from the first line', () => {
    expect(slackBranchName('Fix the flaky login test!\nmore')).toBe('fix-the-flaky-login-test');
    expect(slackBranchName('Add   retries (v2) to API/client')).toBe(
      'add-retries-v2-to-api-client'
    );
  });

  it('keeps it short, cutting at a word', () => {
    const slug = slackBranchName(
      'please investigate why the nightly build keeps failing on arm machines'
    );
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toBe('please-investigate-why-the-nightly-build');
  });

  it('is null when nothing usable is left', () => {
    expect(slackBranchName('!!')).toBeNull();
    expect(slackBranchName('')).toBeNull();
    expect(slackBranchName(undefined)).toBeNull();
  });
});
