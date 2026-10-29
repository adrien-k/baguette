/**
 * Which repository a Slack-started session uses.
 */
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { reposNamedInText, resolveRepo, userRepos } from '../slack-repos.js';
import { insertRepo, insertSession, insertUser } from './slack-test-helpers.js';

const db = createTestDb();

describe('reposNamedInText', () => {
  const repos = [
    { id: 1, full_name: 'acme/web' },
    { id: 2, full_name: 'acme/shop-api' },
    { id: 3, full_name: 'acme/ui' },
  ];
  const names = (text) => reposNamedInText(repos, text).map((r) => r.full_name);

  it('matches a full name anywhere in the text', () => {
    expect(names('please look at ACME/web today')).toEqual(['acme/web']);
  });

  it('matches a short name as a whole word', () => {
    expect(names('fix the shop-api timeouts')).toEqual(['acme/shop-api']);
    expect(names('the website is slow')).toEqual([]);
  });

  it('prefers full-name matches over short-name matches', () => {
    expect(names('acme/web and the shop-api')).toEqual(['acme/web']);
  });

  it('ignores very short repo names', () => {
    expect(names('fix the ui')).toEqual([]);
  });
});

describe('userRepos', () => {
  it('lists only the user’s repos that are not deleted', async () => {
    const mine = await insertUser(db);
    const other = await insertUser(db);
    await insertRepo(db, mine, 'acme/web');
    const gone = await insertRepo(db, mine, 'acme/old');
    await db('repos').where({ id: gone }).update({ deleted_at: new Date().toISOString() });
    await insertRepo(db, other, 'acme/secret');

    expect((await userRepos(db, mine)).map((r) => r.full_name)).toEqual(['acme/web']);
  });
});

describe('resolveRepo', () => {
  it('says so when the user has no repos', async () => {
    const userId = await insertUser(db);
    expect(await resolveRepo(db, userId, null, 'anything')).toEqual({
      error: 'You have no repositories in Baguette yet.',
    });
  });

  it('resolves an explicit repo= by full or short name', async () => {
    const userId = await insertUser(db);
    await insertRepo(db, userId, 'acme/web');
    await insertRepo(db, userId, 'acme/shop');
    expect((await resolveRepo(db, userId, 'ACME/shop')).repo.full_name).toBe('acme/shop');
    expect((await resolveRepo(db, userId, 'web')).repo.full_name).toBe('acme/web');
  });

  it('lists the user’s repos when the explicit one is unknown', async () => {
    const userId = await insertUser(db);
    await insertRepo(db, userId, 'acme/web');
    const { error } = await resolveRepo(db, userId, 'nope');
    expect(error).toContain('couldn\'t find "nope"');
    expect(error).toContain('`acme/web`');
  });

  it('uses the only repo without asking', async () => {
    const userId = await insertUser(db);
    await insertRepo(db, userId, 'acme/web');
    expect((await resolveRepo(db, userId, null, 'fix it')).repo.full_name).toBe('acme/web');
  });

  it('uses a repo named in the message', async () => {
    const userId = await insertUser(db);
    await insertRepo(db, userId, 'acme/web');
    await insertRepo(db, userId, 'acme/shop');
    expect((await resolveRepo(db, userId, null, 'speed up shop')).repo.full_name).toBe('acme/shop');
  });

  it('asks which one when the message names several', async () => {
    const userId = await insertUser(db);
    await insertRepo(db, userId, 'acme/web');
    await insertRepo(db, userId, 'acme/shop');
    const { error } = await resolveRepo(db, userId, null, 'compare web and shop');
    expect(error).toContain('Which one');
  });

  it('falls back to the repo of the latest session', async () => {
    const userId = await insertUser(db);
    await insertRepo(db, userId, 'acme/web');
    const shopId = await insertRepo(db, userId, 'acme/shop');
    await insertSession(db, userId, { repo_id: shopId, repo_full_name: 'acme/shop' });
    expect((await resolveRepo(db, userId, null, 'fix it')).repo.full_name).toBe('acme/shop');
  });

  it('asks for repo= when nothing points to one', async () => {
    const userId = await insertUser(db);
    await insertRepo(db, userId, 'acme/web');
    await insertRepo(db, userId, 'acme/shop');
    const { error } = await resolveRepo(db, userId, null, 'fix it');
    expect(error).toContain('Which repo?');
    expect(error).toContain('`acme/shop`');
  });
});
