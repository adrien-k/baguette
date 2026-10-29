import { describe, expect, it } from 'vitest';
import {
  describeSlackUserMessage,
  isSlackUserMessage,
  slackMessageMeta,
} from '../slack-user-message.js';

describe('slackMessageMeta', () => {
  it('records who wrote the message and what they wrote', () => {
    expect(slackMessageMeta({ userId: 'U1', userName: 'Jan', text: 'fix it' })).toEqual({
      source: 'slack',
      slack: {
        user_id: 'U1',
        user_name: 'Jan',
        text: 'fix it',
        suggestion: false,
        untagged: false,
      },
    });
  });

  it('keeps the suggestion and untagged flags, and copes with missing values', () => {
    expect(slackMessageMeta({ userId: 'U1', suggestion: true, untagged: true }).slack).toEqual({
      user_id: 'U1',
      user_name: null,
      text: '',
      suggestion: true,
      untagged: true,
    });
  });
});

describe('isSlackUserMessage', () => {
  it('is true only for user messages marked as Slack', () => {
    const meta = slackMessageMeta({ userId: 'U1', text: 'x' });
    expect(isSlackUserMessage({ type: 'user', ...meta })).toBe(true);
    expect(isSlackUserMessage({ type: 'assistant', ...meta })).toBe(false);
    expect(isSlackUserMessage({ type: 'user', source: 'slack' })).toBe(false);
    expect(isSlackUserMessage({ type: 'user', source: 'loop' })).toBe(false);
    expect(isSlackUserMessage(null)).toBe(false);
  });
});

describe('describeSlackUserMessage', () => {
  const message = (overrides) => ({
    type: 'user',
    ...slackMessageMeta({ userId: 'U1', userName: 'Jan', text: 'fix the test', ...overrides }),
  });

  it('labels the message "Slack (name)" and shows what they wrote', () => {
    expect(describeSlackUserMessage(message())).toEqual({
      label: 'Slack (Jan)',
      text: 'fix the test',
      suggestion: false,
      untagged: false,
    });
  });

  it('falls back to the Slack id when the name is unknown', () => {
    expect(describeSlackUserMessage(message({ userName: null })).label).toBe('Slack (U1)');
  });

  it('passes the suggestion and untagged flags on', () => {
    const view = describeSlackUserMessage(message({ suggestion: true, untagged: true }));
    expect(view).toMatchObject({ suggestion: true, untagged: true });
  });

  it('is null for anything else', () => {
    expect(describeSlackUserMessage({ type: 'user', content: 'hi' })).toBeNull();
    expect(describeSlackUserMessage(undefined)).toBeNull();
  });
});
