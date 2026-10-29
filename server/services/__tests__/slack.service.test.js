/**
 * Integration tests for the admin Slack apps CRUD service.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers, getServiceOptions } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSlackService } from '../feathers/slack.service.js';

const db = createTestDb();

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

describe('who can manage Slack apps', () => {
  const member = { provider: 'rest', user: { id: 2 } };

  it('any signed-in user can, as everyone can approve accounts', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, member);
    expect((await service().get(created.id, member)).name).toBe('acme');
    await service().patch(created.id, { name: 'renamed' }, member);
    expect((await service().find(member))[0].name).toBe('renamed');
    await service().remove(created.id, member);
    expect(await db('slack_apps').count({ n: '*' }).first()).toEqual({ n: 0 });
  });

  it('lets server-side calls through without a user', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, {});
    expect((await service().find({}))[0].id).toBe(created.id);
  });
});

describe('stored secrets are never returned to clients', () => {
  const SECRETS = {
    bot_token: 'xoxb-AAAA-bot-secret-ZZZZ',
    app_token: 'xapp-1-BBBB-app-secret-YYYY',
    client_secret: 'cs-CCCC-client-secret-XXXX',
    signing_secret: 'sg-DDDD-signing-secret-WWWW',
  };
  const expectNoSecrets = (result) => {
    const json = JSON.stringify(result);
    for (const value of Object.values(SECRETS)) {
      expect(json).not.toContain(value);
      expect(json).not.toContain(value.slice(0, 3));
      expect(json).not.toContain(value.slice(-3));
    }
    for (const field of Object.keys(SECRETS)) {
      expect(result).not.toHaveProperty(field);
      expect(result).not.toHaveProperty(`${field}_encrypted`);
      expect(result[`has_${field}`]).toBe(true);
    }
  };

  it('on create, get, find, patch and remove — only whether each one is set', async () => {
    const created = await service().create({ name: 'acme', client_id: '1.2', ...SECRETS }, params);
    expectNoSecrets(created);
    expectNoSecrets(await service().get(created.id, params));
    expectNoSecrets((await service().find(params))[0]);
    expectNoSecrets(await service().patch(created.id, { name: 'renamed' }, params));
    expectNoSecrets(await service().remove(created.id, params));
  });

  it('say a secret is not set when it is not', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-only' }, params);
    expect(created).toMatchObject({
      has_bot_token: true,
      has_app_token: false,
      has_client_secret: false,
      has_signing_secret: false,
    });
  });

  it('can be replaced through patch, but never read back — or written around the encryption', async () => {
    const created = await service().create({ name: 'acme', ...SECRETS }, params);
    const patched = await service().patch(
      created.id,
      {
        bot_token: 'xoxb-NEW-token',
        bot_token_encrypted: 'plain-injected',
        has_bot_token: false,
        app_token_encrypted: 'plain-injected',
      },
      params
    );
    expect(JSON.stringify(patched)).not.toContain('xoxb-NEW-token');
    expect(patched.has_bot_token).toBe(true);
    const internal = await service().get(created.id, {});
    expect(internal).toMatchObject({
      bot_token: 'xoxb-NEW-token',
      app_token: SECRETS.app_token,
      client_secret: SECRETS.client_secret,
      signing_secret: SECRETS.signing_secret,
    });
  });

  it('are not in the result of testing the connection', async () => {
    const created = await service().create({ name: 'acme', ...SECRETS }, params);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ ok: true, team: 'T', team_id: 'T1', user: 'bot', user_id: 'U1' }),
      })
    );
    const result = await service().test(created.id, params);
    for (const value of Object.values(SECRETS)) expect(JSON.stringify(result)).not.toContain(value);
  });

  it('stay available in plaintext to server-side callers', async () => {
    const created = await service().create({ name: 'acme', ...SECRETS }, params);
    expect(await service().get(created.id, {})).toMatchObject(SECRETS);
  });
});

describe('create', () => {
  it('stores a named app and encrypts the token', async () => {
    const result = await service().create({ name: 'acme', bot_token: 'xoxb-super-secret' }, params);

    expect(result.name).toBe('acme');
    expect(result.has_bot_token).toBe(true);
    expect(result).not.toHaveProperty('bot_token');

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
    expect(result.has_bot_token).toBe(true);
    expect(result).not.toHaveProperty('bot_token');
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

describe('OAuth and Socket Mode credentials', () => {
  const oauth = { client_id: '1.2', client_secret: 'cs-secret', signing_secret: 'sign-secret' };

  it('creates an app from OAuth credentials alone, with no bot token yet', async () => {
    const result = await service().create({ name: 'acme', ...oauth }, params);
    expect(result.client_id).toBe('1.2');
    expect(result).toMatchObject({
      has_client_secret: true,
      has_signing_secret: true,
      has_bot_token: false,
    });
    const row = await db('slack_apps').first();
    expect(row.bot_token_encrypted).toBe('');
    expect(row.client_secret_encrypted).not.toContain('cs-secret');
  });

  it('refuses incomplete OAuth credentials', async () => {
    await expect(
      service().create({ name: 'acme', client_id: '1.2', client_secret: 'x' }, params)
    ).rejects.toThrow(/bot_token, or client_id, client_secret and signing_secret/);
  });

  it('stores and decrypts an app-level token for Socket Mode', async () => {
    const created = await service().create(
      { name: 'acme', bot_token: 'xoxb-one', app_token: 'xapp-one' },
      params
    );
    expect(created.has_app_token).toBe(true);
    expect(created).not.toHaveProperty('app_token');
    const internal = await service().get(created.id, {});
    expect(internal.app_token).toBe('xapp-one');
    expect(internal.bot_token).toBe('xoxb-one');
  });

  it('adds an app token or OAuth credentials to an existing app', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    await service().patch(created.id, { app_token: 'xapp-two', ...oauth }, params);
    const internal = await service().get(created.id, {});
    expect(internal).toMatchObject({
      app_token: 'xapp-two',
      client_id: '1.2',
      client_secret: 'cs-secret',
      signing_secret: 'sign-secret',
    });
  });

  it('trims the client id', async () => {
    const created = await service().create(
      { name: 'acme', ...oauth, client_id: '  1.2  ' },
      params
    );
    expect(created.client_id).toBe('1.2');
  });

  it('tells the settings page where Slack should send events, and whether the app is installed', async () => {
    const created = await service().create({ name: 'acme', ...oauth }, params);
    expect(created.events_url).toMatch(/\/api\/slack\/events$/);
    expect(created.redirect_uri).toMatch(/\/api\/slack\/oauth\/callback$/);
    expect(created.installed).toBe(false);

    await db('slack_apps').where({ id: created.id }).update({ team_id: 'T1', team_name: 'Futrou' });
    const fetched = await service().get(created.id, params);
    expect(fetched).toMatchObject({ installed: true, team_name: 'Futrou' });
    const listed = await service().find(params);
    expect(listed[0].installed).toBe(true);
  });

  it('keeps install-time fields (workspace, bot user) out of what clients can set', async () => {
    const created = await service().create(
      { name: 'acme', bot_token: 'xoxb-one', team_id: 'T9', bot_user_id: 'UX', api_app_id: 'A9' },
      params
    );
    expect(created.team_id).toBeNull();
    expect(created.bot_user_id).toBeNull();
    await service()
      .patch(created.id, { team_id: 'T9' }, params)
      .catch(() => {});
    expect((await db('slack_apps').first()).team_id).toBeNull();
  });
});

describe('linkUser', () => {
  it('connects a Slack user to a Baguette user, and moves the link when asked again', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    const [first] = await db('users').insert({ github_id: 1, username: 'a', approved: true });
    const [second] = await db('users').insert({ github_id: 2, username: 'b', approved: true });

    await service().linkUser({ slack_app_id: created.id, slack_user_id: 'U1', user_id: first });
    await service().linkUser({ slack_app_id: created.id, slack_user_id: 'U1', user_id: second });

    const links = await db('slack_user_links');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ slack_user_id: 'U1', user_id: second });
  });

  it('refuses an unknown Slack app', async () => {
    await expect(
      service().linkUser({ slack_app_id: 999, slack_user_id: 'U1', user_id: 1 })
    ).rejects.toThrow(/not found/);
  });

  it('is internal: it is not one of the service’s public methods', () => {
    const { methods } = getServiceOptions(service());
    expect(methods).toEqual(
      expect.arrayContaining(['find', 'get', 'create', 'patch', 'remove', 'test'])
    );
    expect(methods).not.toContain('linkUser');
    expect(methods).not.toContain('saveInstall');
  });
});

describe('saveInstall', () => {
  it('stores the bot token (encrypted) and the workspace identity', async () => {
    const created = await service().create(
      { name: 'acme', client_id: '1.2', client_secret: 'cs', signing_secret: 'ss' },
      params
    );
    await service().saveInstall(created.id, {
      botToken: 'xoxb-new',
      botUserId: 'UBOT',
      apiAppId: 'A1',
      teamId: 'T1',
      teamName: 'Futrou',
    });

    const row = await db('slack_apps').first();
    expect(row.bot_token_encrypted).not.toContain('xoxb-new');
    expect(row).toMatchObject({
      bot_user_id: 'UBOT',
      api_app_id: 'A1',
      team_id: 'T1',
      team_name: 'Futrou',
    });
    expect(row.installed_at).toBeTruthy();
    expect((await service().get(created.id, {})).bot_token).toBe('xoxb-new');
    expect((await service().get(created.id, params)).installed).toBe(true);
  });

  it('refuses an unknown Slack app', async () => {
    await expect(service().saveInstall(999, { botToken: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('saveIdentity', () => {
  it('stores who the bot is in its workspace', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    await service().saveIdentity(created.id, {
      bot_user_id: 'UBOT',
      team_id: 'T1',
      team_name: 'Futrou',
      api_app_id: 'A1',
    });
    expect(await db('slack_apps').first()).toMatchObject({
      bot_user_id: 'UBOT',
      team_id: 'T1',
      team_name: 'Futrou',
      api_app_id: 'A1',
    });
  });

  it('changes only what it is given', async () => {
    const created = await service().create({ name: 'acme', bot_token: 'xoxb-one' }, params);
    await service().saveIdentity(created.id, { bot_user_id: 'UBOT', team_name: 'Futrou' });
    await service().saveIdentity(created.id, { api_app_id: 'A1' });
    await service().saveIdentity(created.id, {});
    expect(await db('slack_apps').first()).toMatchObject({
      bot_user_id: 'UBOT',
      team_name: 'Futrou',
      api_app_id: 'A1',
    });
  });

  it('is internal: not one of the service’s public methods', () => {
    expect(getServiceOptions(service()).methods).not.toContain('saveIdentity');
  });
});
