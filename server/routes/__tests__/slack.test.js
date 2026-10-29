/**
 * Slack HTTP routes: signed events, the "Add to Slack" install and the account-link page.
 */
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { sign } from 'cookie-signature';
import { feathers } from 'feathers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';

const slack = vi.hoisted(() => ({ oauthAccess: vi.fn(), getUserInfo: vi.fn() }));
vi.mock('../../services/slack.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...slack,
}));

import createSlackRoutes from '../slack.js';
import { registerSlackService } from '../../services/feathers/slack.service.js';
import { registerSlackThreadsService } from '../../services/feathers/slack-threads.service.js';
import { createSlackBot } from '../../services/slack-bot.js';
import { readSlackToken, signSlackToken } from '../../services/slack-auth.js';
import { decrypt, encrypt } from '../../lib/encrypt.js';
import { insertSlackApp, insertUser } from '../../services/__tests__/slack-test-helpers.js';

const db = createTestDb();
const COOKIE_SECRET = 'test-cookie-secret';
const SIGNING_SECRET = 'signing-secret';

let server;
let baseUrl;
let bot;

beforeEach(async () => {
  const app = feathers();
  app.set('db', db);
  registerSlackService(app);
  registerSlackThreadsService(app);
  app.use('users', {
    async get(id) {
      return db('users').where({ id }).first();
    },
  });
  bot = createSlackBot(app);
  bot.handleEventCallback = vi.fn().mockResolvedValue(undefined);

  const web = express();
  web.use(cookieParser(COOKIE_SECRET));
  web.use(express.urlencoded({ extended: true }));
  web.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  web.use(createSlackRoutes(app, bot));
  server = http.createServer(web);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  slack.oauthAccess.mockReset();
  slack.getUserInfo.mockReset().mockResolvedValue({ id: 'U1', name: 'Jan' });
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const cookieFor = (userId) => `userId=s%3A${sign(String(userId), COOKIE_SECRET)}`;
const get = (path, { userId } = {}) =>
  fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    headers: userId ? { cookie: cookieFor(userId) } : {},
  });

function signedPost(
  body,
  { secret = SIGNING_SECRET, timestamp = Math.floor(Date.now() / 1000), headers = {} } = {}
) {
  const raw = JSON.stringify(body);
  const signature = `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
  return fetch(`${baseUrl}/api/slack/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': signature,
      ...headers,
    },
    body: raw,
  });
}

describe('POST /api/slack/events', () => {
  beforeEach(async () => {
    await insertSlackApp(db, {
      api_app_id: 'A1',
      signing_secret_encrypted: encrypt(SIGNING_SECRET),
    });
  });

  it('answers Slack’s URL verification challenge', async () => {
    const res = await signedPost({ type: 'url_verification', challenge: 'abc', api_app_id: 'A1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'abc' });
  });

  it('acknowledges an event and hands it to the bot', async () => {
    const body = {
      type: 'event_callback',
      api_app_id: 'A1',
      event_id: 'Ev1',
      event: { type: 'app_mention' },
    };
    const res = await signedPost(body);
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(bot.handleEventCallback).toHaveBeenCalled());
    const [slackApp, payload] = bot.handleEventCallback.mock.calls[0];
    expect(slackApp.api_app_id).toBe('A1');
    expect(payload).toEqual(body);
  });

  it('rejects a bad signature, a wrong secret and a stale timestamp', async () => {
    const body = { type: 'event_callback', api_app_id: 'A1', event: {} };
    expect((await signedPost(body, { headers: { 'x-slack-signature': 'v0=bad' } })).status).toBe(
      401
    );
    expect((await signedPost(body, { secret: 'other' })).status).toBe(401);
    expect(
      (await signedPost(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status
    ).toBe(401);
    expect(bot.handleEventCallback).not.toHaveBeenCalled();
  });

  it('rejects an event for an app Baguette does not know, or one without a signing secret', async () => {
    expect((await signedPost({ type: 'event_callback', api_app_id: 'NOPE' })).status).toBe(401);
    await insertSlackApp(db, {
      name: 'nosecret',
      api_app_id: 'A2',
      signing_secret_encrypted: null,
    });
    expect((await signedPost({ type: 'event_callback', api_app_id: 'A2' })).status).toBe(401);
  });

  it('rejects junk before any database work: no lookup, no decryption', async () => {
    const lookup = vi.spyOn(bot, 'findAppByApiAppId');
    const body = { type: 'event_callback', api_app_id: 'A1', event: {} };
    const junk = [
      { headers: { 'x-slack-signature': 'v0=bad' } },
      { headers: { 'x-slack-signature': '' } },
      { headers: { 'x-slack-request-timestamp': 'soon' } },
      { timestamp: Math.floor(Date.now() / 1000) - 3600 },
    ];
    for (const options of junk) expect((await signedPost(body, options)).status).toBe(401);

    const bare = await fetch(`${baseUrl}/api/slack/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(bare.status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();

    // A well-formed but wrongly signed request does get as far as the one matching app.
    expect((await signedPost(body, { secret: 'other' })).status).toBe(401);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('answers 429 to a client that keeps sending bad requests — and recovers when the window ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const body = { type: 'event_callback', api_app_id: 'A1', event: {} };
      const bad = () => signedPost(body, { headers: { 'x-slack-signature': 'v0=bad' } });
      for (let i = 0; i < 30; i += 1) expect((await bad()).status).toBe(401);
      expect((await bad()).status).toBe(429);
      // Even a correctly signed request waits out the block.
      expect((await signedPost(body)).status).toBe(429);

      vi.setSystemTime(Date.now() + 61_000);
      expect(
        (await signedPost({ type: 'url_verification', challenge: 'c', api_app_id: 'A1' })).status
      ).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not count good requests towards the limit', async () => {
    for (let i = 0; i < 40; i += 1) {
      const res = await signedPost({ type: 'app_rate_limited', api_app_id: 'A1' });
      expect(res.status).toBe(200);
    }
  });

  it('does not process Slack retries again', async () => {
    const res = await signedPost(
      { type: 'event_callback', api_app_id: 'A1', event: {} },
      { headers: { 'x-slack-retry-num': '1' } }
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(bot.handleEventCallback).not.toHaveBeenCalled();
  });

  it('ignores payload types it does not handle', async () => {
    const res = await signedPost({ type: 'app_rate_limited', api_app_id: 'A1' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(bot.handleEventCallback).not.toHaveBeenCalled();
  });

  it('still answers 200 when the bot fails', async () => {
    bot.handleEventCallback.mockRejectedValue(new Error('boom'));
    const res = await signedPost({ type: 'event_callback', api_app_id: 'A1', event: {} });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/slack/install', () => {
  async function appWithOAuth(overrides = {}) {
    return insertSlackApp(db, {
      client_id: '123.456',
      client_secret_encrypted: encrypt('secret'),
      ...overrides,
    });
  }

  it('asks you to log in first', async () => {
    const id = await appWithOAuth();
    const res = await get(`/api/slack/install?app_id=${id}`);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Log in to Baguette');
  });

  it('sends a logged-in user to Slack’s authorize page with all the scopes', async () => {
    const userId = await insertUser(db);
    const id = await appWithOAuth();
    const res = await get(`/api/slack/install?app_id=${id}`, { userId });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location'));
    expect(location.origin + location.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(location.searchParams.get('client_id')).toBe('123.456');
    expect(location.searchParams.get('redirect_uri')).toMatch(/\/api\/slack\/oauth\/callback$/);
    const scopes = location.searchParams.get('scope').split(',');
    expect(scopes).toEqual(
      expect.arrayContaining([
        'app_mentions:read',
        'chat:write',
        'assistant:write',
        'users:read',
        'files:read',
        'channels:history',
      ])
    );
    expect(readSlackToken(location.searchParams.get('state'))).toMatchObject({
      kind: 'install',
      app_id: id,
      user_id: userId,
    });
  });

  it('refuses an app without OAuth credentials, or one that does not exist', async () => {
    const userId = await insertUser(db);
    const plain = await insertSlackApp(db, { client_id: null });
    expect((await get(`/api/slack/install?app_id=${plain}`, { userId })).status).toBe(400);
    expect((await get('/api/slack/install?app_id=999', { userId })).status).toBe(400);
    expect((await get('/api/slack/install', { userId })).status).toBe(400);
  });

  it('does not treat an unapproved user as logged in', async () => {
    const userId = await insertUser(db, { approved: false });
    const id = await appWithOAuth();
    expect((await get(`/api/slack/install?app_id=${id}`, { userId })).status).toBe(401);
  });
});

describe('GET /api/slack/oauth/callback', () => {
  const access = {
    botToken: 'xoxb-new',
    botUserId: 'UNEW',
    apiAppId: 'ANEW',
    teamId: 'T9',
    teamName: 'Futrou',
  };

  async function setup() {
    const userId = await insertUser(db);
    const appId = await insertSlackApp(db, {
      client_id: '123.456',
      client_secret_encrypted: encrypt('client-secret'),
      bot_token_encrypted: '',
      bot_user_id: null,
      team_id: null,
      api_app_id: null,
    });
    const state = signSlackToken({ kind: 'install', app_id: appId, user_id: userId });
    return { userId, appId, state };
  }

  it('stores the bot token and workspace, then returns to the settings page', async () => {
    const { userId, appId, state } = await setup();
    slack.oauthAccess.mockResolvedValue(access);

    const res = await get(`/api/slack/oauth/callback?code=abc&state=${state}`, { userId });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/settings\/integrations$/);
    expect(slack.oauthAccess).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: '123.456', clientSecret: 'client-secret', code: 'abc' })
    );
    const row = await db('slack_apps').where({ id: appId }).first();
    expect(decrypt(row.bot_token_encrypted)).toBe('xoxb-new');
    expect(row).toMatchObject({
      bot_user_id: 'UNEW',
      api_app_id: 'ANEW',
      team_id: 'T9',
      team_name: 'Futrou',
    });
    expect(row.installed_at).toBeTruthy();
  });

  it('asks you to log in first', async () => {
    const { state } = await setup();
    expect((await get(`/api/slack/oauth/callback?code=abc&state=${state}`)).status).toBe(401);
  });

  it('rejects a missing, garbled or expired state', async () => {
    const { userId } = await setup();
    expect((await get('/api/slack/oauth/callback?code=abc', { userId })).status).toBe(400);
    expect((await get('/api/slack/oauth/callback?code=abc&state=junk', { userId })).status).toBe(
      400
    );
    expect(slack.oauthAccess).not.toHaveBeenCalled();
  });

  it('rejects a state that was issued to someone else, or for another purpose', async () => {
    const { appId, state } = await setup();
    const other = await insertUser(db);
    expect(
      (await get(`/api/slack/oauth/callback?code=abc&state=${state}`, { userId: other })).status
    ).toBe(400);
    const linkState = signSlackToken({ kind: 'link', slack_app_id: appId, user_id: other });
    expect(
      (await get(`/api/slack/oauth/callback?code=abc&state=${linkState}`, { userId: other })).status
    ).toBe(400);
  });

  it('explains a cancelled install', async () => {
    const { userId, state } = await setup();
    const res = await get(`/api/slack/oauth/callback?error=access_denied&state=${state}`, {
      userId,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('access_denied');
    expect(slack.oauthAccess).not.toHaveBeenCalled();
  });

  it('reports a failed code exchange, escaping the message', async () => {
    const { userId, appId, state } = await setup();
    slack.oauthAccess.mockRejectedValue(new Error('<script>bad_code</script>'));
    const res = await get(`/api/slack/oauth/callback?code=abc&state=${state}`, { userId });
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain('Slack install failed');
    expect(html).not.toContain('<script>');
    expect((await db('slack_apps').where({ id: appId }).first()).bot_token_encrypted).toBe('');
  });
});

describe('linking a Slack account', () => {
  const linkToken = (appId = 1, slackUser = 'U1') =>
    signSlackToken({ slack_app_id: appId, slack_user_id: slackUser });

  const confirm = (token, { userId } = {}) =>
    fetch(`${baseUrl}/api/slack/link`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(userId ? { cookie: cookieFor(userId) } : {}),
      },
      body: new URLSearchParams({ token }).toString(),
    });

  describe('GET: the confirmation page', () => {
    it('says whose Slack account is being connected, and links nothing yet', async () => {
      const userId = await insertUser(db, { username: 'alice' });
      const appId = await insertSlackApp(db);
      const res = await get(`/api/slack/link?token=${linkToken(appId)}`, { userId });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Connect your Slack account?');
      expect(html).toContain('Jan (U1)');
      expect(html).toContain('alice');
      expect(html).toContain('<form method="post" action="/api/slack/link">');
      expect(await db('slack_user_links')).toHaveLength(0);
    });

    it('falls back to the Slack id when the name is unknown', async () => {
      const userId = await insertUser(db);
      const appId = await insertSlackApp(db);
      slack.getUserInfo.mockRejectedValue(new Error('missing_scope'));
      const html = await (
        await get(`/api/slack/link?token=${linkToken(appId, 'U7')}`, { userId })
      ).text();
      expect(html).toContain('<strong>U7</strong>');
    });

    it('asks you to log in first', async () => {
      const appId = await insertSlackApp(db);
      const res = await get(`/api/slack/link?token=${linkToken(appId)}`);
      expect(res.status).toBe(401);
    });

    it('rejects an expired, invalid or orphaned link', async () => {
      const userId = await insertUser(db);
      expect((await get('/api/slack/link?token=junk', { userId })).status).toBe(400);
      expect((await get('/api/slack/link', { userId })).status).toBe(400);
      expect(
        (await get(`/api/slack/link?token=${signSlackToken({ slack_app_id: 1 })}`, { userId }))
          .status
      ).toBe(400);
      expect((await get(`/api/slack/link?token=${linkToken(9999)}`, { userId })).status).toBe(400);
    });

    it('does not accept an account that is not approved yet', async () => {
      const userId = await insertUser(db, { approved: false });
      const appId = await insertSlackApp(db);
      expect((await get(`/api/slack/link?token=${linkToken(appId)}`, { userId })).status).toBe(401);
    });
  });

  describe('POST: confirming', () => {
    it('links the Slack user to the logged-in Baguette user', async () => {
      const userId = await insertUser(db);
      const appId = await insertSlackApp(db);
      const res = await confirm(linkToken(appId), { userId });

      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Slack connected');
      expect(await db('slack_user_links')).toEqual([
        expect.objectContaining({ slack_app_id: appId, slack_user_id: 'U1', user_id: userId }),
      ]);
    });

    it('moves an existing link to the new account instead of duplicating it', async () => {
      const first = await insertUser(db);
      const second = await insertUser(db);
      const appId = await insertSlackApp(db);
      await confirm(linkToken(appId), { userId: first });
      await confirm(linkToken(appId), { userId: second });

      const links = await db('slack_user_links');
      expect(links).toHaveLength(1);
      expect(links[0].user_id).toBe(second);
    });

    it('needs a login, and links nothing without one', async () => {
      const appId = await insertSlackApp(db);
      expect((await confirm(linkToken(appId))).status).toBe(401);
      expect(await db('slack_user_links')).toHaveLength(0);
    });

    it('rejects an expired or invalid token', async () => {
      const userId = await insertUser(db);
      expect((await confirm('junk', { userId })).status).toBe(400);
      expect((await confirm('', { userId })).status).toBe(400);
      expect(await db('slack_user_links')).toHaveLength(0);
    });

    it('does not link an account that is not approved yet', async () => {
      const userId = await insertUser(db, { approved: false });
      const appId = await insertSlackApp(db);
      expect((await confirm(linkToken(appId), { userId })).status).toBe(401);
      expect(await db('slack_user_links')).toHaveLength(0);
    });
  });
});
