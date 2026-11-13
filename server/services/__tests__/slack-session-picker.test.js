/**
 * Switching a Slack thread to another session: request detection, matching and picker blocks.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_OLD_ACTION_PREFIX,
  KEEP_OLD_ACTION_PREFIX,
  SWITCH_ACTION_PREFIX,
  buildOldSessionBlocks,
  parseOldSessionAction,
  buildSessionPickerBlocks,
  parseSwitchRequest,
  rankSessions,
  sessionPickerLabel,
} from '../slack-session-picker.js';

describe('parseSwitchRequest', () => {
  it.each([
    ['switch to the login session', ['login']],
    ['baguette, continue in session 12', ['12']],
    ['go back to my checkout fix session', ['checkout', 'fix']],
    ['resume session 7', ['7']],
    ['switch session', []],
    ['Please switch to the Payments session', ['payments']],
  ])('recognises "%s"', (text, tokens) => {
    expect(parseSwitchRequest(text)).toEqual({ tokens });
  });

  it.each([
    'change the session timeout to 30 minutes',
    'continue on the session store bug',
    'fix the flaky login test',
    'start a new session',
    '',
    undefined,
  ])('leaves "%s" alone', (text) => {
    expect(parseSwitchRequest(text)).toBeNull();
  });
});

describe('rankSessions', () => {
  const sessions = [
    { id: 1, label: 'Fix login test', repo_full_name: 'acme/web', initial_prompt: 'login flake' },
    { id: 2, label: 'Checkout redesign', repo_full_name: 'acme/shop', remote_branch: 'feat/cart' },
    { id: 12, label: null, repo_full_name: 'acme/api', initial_prompt: 'speed up search' },
  ];
  const ids = (tokens) => rankSessions(sessions, tokens).map((s) => s.id);

  it('matches on id, title, repo, branch and prompt', () => {
    expect(ids(['12'])).toEqual([12]);
    expect(ids(['login'])).toEqual([1]);
    expect(ids(['shop'])).toEqual([2]);
    expect(ids(['cart'])).toEqual([2]);
    expect(ids(['search'])).toEqual([12]);
  });

  it('puts the strongest match first and drops non-matches', () => {
    expect(ids(['acme', 'checkout'])).toEqual([2, 1, 12]);
    expect(ids(['nothing'])).toEqual([]);
    expect(ids([])).toEqual([]);
  });
});

describe('sessionPickerLabel', () => {
  it('shows "#id · title · repo"', () => {
    expect(sessionPickerLabel({ id: 1, label: 'Fix login test', repo_full_name: 'acme/web' })).toBe(
      '#1 · Fix login test · web'
    );
  });

  it('falls back to the first line of the prompt, then to "Untitled"', () => {
    expect(
      sessionPickerLabel({
        id: 12,
        initial_prompt: 'speed up search\nmore',
        repo_full_name: 'a/api',
      })
    ).toBe('#12 · speed up search · api');
    expect(sessionPickerLabel({ id: 3 })).toBe('#3 · Untitled');
  });

  it('stays within the 75 character limit Slack allows', () => {
    const label = sessionPickerLabel({ id: 1, label: 'x'.repeat(200), repo_full_name: 'a/b' });
    expect(label).toHaveLength(75);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('buildSessionPickerBlocks', () => {
  const make = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `S${i}`, repo_full_name: 'a/b' }));

  it('shows up to five sessions as buttons', () => {
    const blocks = buildSessionPickerBlocks('Which?', make(5));
    expect(blocks[0].text.text).toBe('Which?');
    expect(blocks[1].elements.map((e) => e.type)).toEqual(Array(5).fill('button'));
    expect(blocks[1].elements[0]).toMatchObject({
      action_id: `${SWITCH_ACTION_PREFIX}_1`,
      value: '1',
    });
  });

  it('switches to a select list above five', () => {
    const blocks = buildSessionPickerBlocks('Which?', make(7));
    expect(blocks[1].elements).toHaveLength(1);
    expect(blocks[1].elements[0]).toMatchObject({
      type: 'static_select',
      action_id: SWITCH_ACTION_PREFIX,
    });
    expect(blocks[1].elements[0].options).toHaveLength(7);
    expect(blocks[1].elements[0].options[6].value).toBe('7');
  });
});

describe('the question about the session a thread left', () => {
  it('has Archive it and Keep it buttons whose ids round-trip through the parser', () => {
    const [section, actions] = buildOldSessionBlocks({
      id: 12,
      label: 'Fix login',
      repo_full_name: 'acme/web',
    });
    expect(section.text.text).toContain('#12 · Fix login · web');
    const [archive, keep] = actions.elements;
    expect(archive.action_id).toBe(`${ARCHIVE_OLD_ACTION_PREFIX}_12`);
    expect(keep.action_id).toBe(`${KEEP_OLD_ACTION_PREFIX}_12`);
    expect(parseOldSessionAction(archive.action_id)).toEqual({ archive: true, sessionId: 12 });
    expect(parseOldSessionAction(keep.action_id)).toEqual({ archive: false, sessionId: 12 });
  });

  it.each(['switch_session_12', 'archive_old_session_', 'archive_old_session_x', '', null])(
    'does not parse %j',
    (actionId) => {
      expect(parseOldSessionAction(actionId)).toBeNull();
    }
  );
});
