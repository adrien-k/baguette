/**
 * Which repositories a Slack app's assistants may work in.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  isRepoInSlackScope,
  parseRepoScope,
  serializeRepoScope,
  sessionRepoScope,
} from '../slack-repo-scope.js';

describe('parseRepoScope', () => {
  it('reads the stored ids', () => {
    expect(parseRepoScope('[1,2]')).toEqual([1, 2]);
  });

  it.each([null, undefined, '', '[]', 'nope', '{"a":1}', '["x"]'])(
    'means no limit for %j',
    (raw) => {
      expect(parseRepoScope(raw)).toBeNull();
    }
  );
});

describe('serializeRepoScope', () => {
  it('stores distinct integer ids', () => {
    expect(serializeRepoScope([2, '3', 2])).toBe('[2,3]');
  });

  it.each([[[]], [null], [undefined], ['x'], [['a']]])('stores nothing for %j', (ids) => {
    expect(serializeRepoScope(ids)).toBeNull();
  });
});

describe('sessionRepoScope', () => {
  const appWith = (scope) => ({
    service: () => ({ repoScope: vi.fn().mockResolvedValue(scope) }),
  });

  it('limits only Slack assistant sessions', async () => {
    expect(await sessionRepoScope(appWith([1]), { id: 1 })).toBeNull();
    expect(await sessionRepoScope(appWith([1]), null)).toBeNull();
    expect(await sessionRepoScope(appWith([1]), { id: 1, slack_app_id: 3 })).toEqual([1]);
  });

  it('allows a repo inside the scope, or any when there is none', async () => {
    const assistant = { id: 1, slack_app_id: 3 };
    expect(await isRepoInSlackScope(appWith([1]), assistant, 1)).toBe(true);
    expect(await isRepoInSlackScope(appWith([1]), assistant, 2)).toBe(false);
    expect(await isRepoInSlackScope(appWith(null), assistant, 2)).toBe(true);
  });
});
