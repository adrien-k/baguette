/**
 * Integration tests for the admin Slack apps CRUD service.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSlackService } from '../feathers/slack.service.js';

const db = createTestDb({ beforeEach, afterEach });

const params = { provider: 'rest', user: { id: 1 } };
const unauthParams = { provider: 'rest' };

let app;

beforeEach(async () => {
  app = feathers();
  app.set('db', db);
  registerSlackService(app);
  await app.setup();
});

afterEach(() => vi.unstubAllGlobals());

const service = () => app.service('admin/slack');

describe('find', () => {
  it('returns an empty list before any app is saved', async () => {
    expect(await service().find(params)).toEqual([]);
  });

  it('rejects unauthenticated access', async () => {
    await expect(service().find(unauthParams)).rejects.toThrow('Not authenticated');
  });
});

describe('create', () => {
  it('stores a named app and encrypts the token', async () => {
    const result = await service().create({ name: 'acme', bot_token: 'xoxb-super-secret' }, params);

    expect(result.name).toBe('acme');
    expect(result.bot_token).toMatch(/•/);
    expect(result.bot_token).not.toBe('xoxb-super-secret');

    const rows = await db('slack_apps').select();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('acme');
    expect(rows[0].bot_token_encrypted).toBeTruthy();
    expect(rows[0].bot_token_encrypted).not.toContain('xoxb-super-secret');
  });

  it('requires a name and token', async () => {
    await expect(service().create({ bot_token: 'xoxb-one' }, params)).rejects.toThrow(/name/);
    await expect(service().create({ name: 'acme' }, params)).rejects.toThrow(/bot_token/);
  });

  it('rejects a duplicate name', async () => {
    await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    await expect(service().create({ name: 'acme', bot_token: 'xoxb-two' }, params)).rejects.toThrow(
      /already exists/
    );
  });

  it('ignores fields that are not Slack app columns', async () => {
    const result = await service().create(
      { name: 'acme', bot_token: 'xoxb-one', id: 42, nope: 'x' },
      params
    );
    expect(result.id).not.toBe(42);
    const row = await db('slack_apps').first();
    expect(row.nope).toBeUndefined();
  });
});

describe('patch', () => {
  it('renames an app without changing the token', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    const result = await service().patch(created.id, { name: 'eng' }, params);

    expect(result.name).toBe('eng');
    expect(result.bot_token).toMatch(/•/);
    const internal = await service().get(created.id, {});
    expect(internal.bot_token).toBe('xoxb-one');
  });

  it('updates the token when a new one is sent', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    await service().patch(created.id, { bot_token: 'xoxb-two' }, params);
    const internal = await service().get(created.id, {});
    expect(internal.bot_token).toBe('xoxb-two');
  });

  it('rejects an empty token', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    await expect(service().patch(created.id, { bot_token: '' }, params)).rejects.toThrow(
      /cannot be empty/
    );
  });
});

describe('remove', () => {
  it('deletes the app', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    await service().remove(created.id, params);
    expect(await db('slack_apps').select()).toHaveLength(0);
  });
});

describe('test', () => {
  it('refuses to call Slack when the stored token cannot be decrypted', async () => {
    const [id] = await db('slack_apps').insert({
      name: 'broken',
      bot_token_encrypted: 'not-valid-ciphertext',
    });
    await expect(service().test(id, params)).rejects.toThrow(/No Slack bot token/);
  });

  it('verifies the stored token against auth.test', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        team: 'Acme',
        team_id: 'T1',
        user: 'baguette',
        user_id: 'U1',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await service().test(created.id, params)).toMatchObject({
      team: 'Acme',
      user: 'baguette',
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer xoxb-one');
  });
});

describe('internal get', () => {
  it('decrypts the stored token for server-side callers', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    const row = await service().get(created.id, {});
    expect(row.bot_token).toBe('xoxb-one');
    expect(row.name).toBe('acme');
  });

  it('treats an undecryptable token as null rather than throwing', async () => {
    const [id] = await db('slack_apps').insert({
      name: 'broken',
      bot_token_encrypted: 'not-valid-ciphertext',
    });
    expect((await service().get(id, {})).bot_token).toBeNull();
  });
});
