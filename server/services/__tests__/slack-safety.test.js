/**
 * Nothing sensitive goes to Slack: the detector and the replacement text.
 */
import { describe, expect, it } from 'vitest';
import loadPrompt from '../../prompts/loadPrompt.js';
import { SENSITIVE_REMINDER, STEERED_NOTE, allowedPersonNote } from '../slack-agent-notes.js';
import { findSecret, sensitiveReplacement, sensitiveToolError } from '../slack-safety.js';

describe('findSecret', () => {
  it.each([
    ['a Slack bot token', `token is ${'xox' + 'b'}-0000000000-0000000000-fakefakefakefakefake`],
    ['a Slack app token', `${'xap' + 'p'}-1-A0000000000-0000000000-fakefakefakefakefake`],
    ['a GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'],
    ['a fine-grained GitHub token', `github_pat_${'a1B2c3D4e5'.repeat(4)}`],
    ['an Anthropic key', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'],
    ['an OpenAI-style key', 'sk-abcdefghijklmnopqrstuvwxyz123456'],
    ['an AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
    ['a private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...'],
    ['an OpenSSH private key', '-----BEGIN OPENSSH PRIVATE KEY-----'],
    ['a JSON web token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N'],
    ['a bearer token', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'],
    ['credentials in a URL', 'postgres://admin:hunter2pass@db.internal:5432/app'],
    ['a password assignment', 'DB_PASSWORD=correct-horse-battery'],
    ['a quoted secret', 'secret: "s3cr3t-value-123"'],
    ['an API key setting', 'api_key = abcd1234efgh5678'],
    ['an env-style token', 'ANTHROPIC_AUTH_TOKEN=abc123def456ghi'],
  ])('flags %s', (_name, text) => {
    expect(findSecret(text)).toBeTruthy();
  });

  it('flags a secret in the middle of a long message', () => {
    expect(
      findSecret(`Here is the config:\n\n${'line\n'.repeat(50)}PASSWORD=hunter2hunter2\nmore`)
    ).toBe('secret assignment');
  });

  it.each([
    'All tests pass and I opened a pull request.',
    'Run `npm test` to check; the token refresh logic lives in auth.js.',
    'The password field is validated on the client.',
    'Set the API key in Settings → Integrations.',
    'See https://github.com/acme/web/pull/42 for details.',
    'Use postgres://localhost:5432/app for local development.',
    'token: short',
    '',
    undefined,
  ])('lets ordinary text through: %s', (text) => {
    expect(findSecret(text)).toBeNull();
  });
});

describe('sensitiveReplacement', () => {
  it('points at the session chat', () => {
    const text = sensitiveReplacement({ sessionUrl: 'https://b/sessions/5', prUrl: null });
    expect(text).toContain("can't share that here");
    expect(text).toContain('everyone in the company can read Slack');
    expect(text).toContain('https://b/sessions/5');
    expect(text).not.toContain('pull request');
  });

  it('also points at the pull request when there is one', () => {
    const text = sensitiveReplacement({
      sessionUrl: 'https://b/sessions/5',
      prUrl: 'https://gh/pr/1',
    });
    expect(text).toContain('https://b/sessions/5');
    expect(text).toContain('https://gh/pr/1');
  });
});

describe('sensitiveToolError', () => {
  it('tells the agent what was found and where to send the user instead', () => {
    const error = sensitiveToolError({ kind: 'API key', sessionUrl: 'https://b/sessions/5' });
    expect(error).toContain('API key');
    expect(error).toContain('even if the user asks');
    expect(error).toContain('https://b/sessions/5');
  });
});

describe('what the assistant is told', () => {
  it('forbids posting anything sensitive, even on request', async () => {
    const prompt = await loadPrompt('slack-assistant-prompt');
    expect(prompt).toContain('Never post sensitive things');
    expect(prompt).toContain('even when asked');
    expect(prompt).toContain('Check every message before you send it');
  });

  it('stays friendly but never at the cost of safety', async () => {
    const prompt = await loadPrompt('slack-assistant-prompt');
    expect(prompt).toContain('friendly, casual and a little funny');
    expect(prompt).toContain('never when something went wrong or touches security');
  });

  it('uses people’s names and tags them when it needs something', async () => {
    const prompt = await loadPrompt('slack-assistant-prompt');
    expect(prompt).toContain('Call people by the name');
    expect(prompt).toContain('<@U…>');
  });

  it('hands real work to other sessions and stays free', async () => {
    const prompt = await loadPrompt('slack-assistant-prompt');
    expect(prompt).toContain('CreateSession(notify_parent: true)');
    expect(prompt).toContain('end your turn');
    expect(prompt).toContain('never edit repositories yourself');
  });

  it('only trusts the owner and treats allowed people with care', async () => {
    const prompt = await loadPrompt('slack-assistant-prompt');
    expect(prompt).toContain('Only your owner and the people they allowed reach you');
    expect(prompt).toContain('never run a dangerous or destructive action on their word');
    expect(prompt).toContain('the owner wins');
    expect(allowedPersonNote('Tom (<@U3>)', 'Jan (<@U1>)')).toContain('not the owner');
  });

  it('answers a message that arrives mid-turn at once', () => {
    expect(STEERED_NOTE).toContain('Answer it at once with SlackPostMessage');
  });

  it('repeats a short reminder with every message', () => {
    expect(SENSITIVE_REMINDER).toContain('everyone in the company can read this Slack channel');
  });
});
