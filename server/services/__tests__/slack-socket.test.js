/**
 * Slack Socket Mode: message handling, connections and seeding from .env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';

const slack = vi.hoisted(() => ({ authTest: vi.fn() }));
vi.mock('../slack.js', async (importOriginal) => ({ ...(await importOriginal()), ...slack }));

import { createSlackSocketManager } from '../slack-socket.js';
import { decryptedApp, insertSlackApp, slackTestApp } from './slack-test-helpers.js';

const db = createTestDb();

class FakeWebSocket {
  static instances = [];
  listeners = {};
  sent = [];
  closed = false;
  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.emit('close', {});
  }
  emit(type, event) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  receive(message) {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

const openOk = (url = 'wss://slack.test/1') =>
  vi.fn().mockResolvedValue({ json: async () => ({ ok: true, url }) });

function makeManager({ rows = [], fetchFn = openOk(), bot } = {}) {
  const botStub = bot ?? {
    handleEventCallback: vi.fn().mockResolvedValue(),
    handleInteraction: vi.fn().mockResolvedValue(),
  };
  // The real service does the writes; `find` is stubbed so a test can change the apps at will.
  const real = slackTestApp(db).service('admin/slack');
  const app = {
    get: () => db,
    service: () => ({
      find: async () => rows,
      saveIdentity: (...args) => real.saveIdentity(...args),
      create: (...args) => real.create(...args),
    }),
  };
  const manager = createSlackSocketManager(app, botStub, {
    fetchFn,
    WebSocketImpl: FakeWebSocket,
  });
  return { manager, bot: botStub, fetchFn };
}

const connected = () => vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));

let manager;
beforeEach(() => {
  FakeWebSocket.instances = [];
  slack.authTest.mockReset().mockResolvedValue({ userId: 'UBOT', teamId: 'T1', team: 'Futrou' });
  manager = null;
});
afterEach(() => {
  manager?.stop();
  vi.useRealTimers();
});

describe('handleMessage', () => {
  const ws = () => ({ send: vi.fn(), close: vi.fn() });
  const app = decryptedApp({ id: 1, api_app_id: 'A1' });

  it('learns the Slack app id from "hello" and stores it', async () => {
    const id = await insertSlackApp(db, { api_app_id: null });
    ({ manager } = makeManager());
    const next = await manager.handleMessage(
      { ...app, id },
      ws(),
      JSON.stringify({ type: 'hello', connection_info: { app_id: 'A9' } })
    );
    expect(next.api_app_id).toBe('A9');
    expect((await db('slack_apps').where({ id }).first()).api_app_id).toBe('A9');
  });

  it('leaves the row alone when "hello" brings nothing new', async () => {
    ({ manager } = makeManager());
    const result = await manager.handleMessage(app, ws(), JSON.stringify({ type: 'hello' }));
    expect(result).toBe(app);
  });

  it('closes the socket when Slack asks to reconnect', async () => {
    ({ manager } = makeManager());
    const socket = ws();
    await manager.handleMessage(app, socket, JSON.stringify({ type: 'disconnect' }));
    expect(socket.close).toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('acks an events_api envelope and hands the payload to the bot', async () => {
    const { manager: m, bot } = makeManager();
    manager = m;
    const socket = ws();
    const payload = { event_id: 'Ev1', event: { type: 'app_mention' } };
    await manager.handleMessage(
      app,
      socket,
      JSON.stringify({ type: 'events_api', envelope_id: 'e1', payload })
    );
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ envelope_id: 'e1' }));
    expect(bot.handleEventCallback).toHaveBeenCalledWith(app, payload);
  });

  it('acks an interactive envelope and hands the payload to the bot', async () => {
    const { manager: m, bot } = makeManager();
    manager = m;
    const socket = ws();
    const payload = { type: 'block_actions' };
    await manager.handleMessage(
      app,
      socket,
      JSON.stringify({ type: 'interactive', envelope_id: 'e2', payload })
    );
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ envelope_id: 'e2' }));
    expect(bot.handleInteraction).toHaveBeenCalledWith(app, payload);
  });

  it('acks envelopes it does not act on, and ignores garbage', async () => {
    const { manager: m, bot } = makeManager();
    manager = m;
    const socket = ws();
    await manager.handleMessage(
      app,
      socket,
      JSON.stringify({ type: 'slash_commands', envelope_id: 'e3' })
    );
    await manager.handleMessage(
      app,
      socket,
      JSON.stringify({ type: 'events_api', envelope_id: 'e4' })
    );
    await manager.handleMessage(app, socket, 'not json');
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(bot.handleEventCallback).not.toHaveBeenCalled();
    expect(bot.handleInteraction).not.toHaveBeenCalled();
  });

  it('survives a bot that throws', async () => {
    const bot = {
      handleEventCallback: vi.fn().mockRejectedValue(new Error('boom')),
      handleInteraction: vi.fn().mockRejectedValue(new Error('boom')),
    };
    ({ manager } = makeManager({ bot }));
    const socket = ws();
    await manager.handleMessage(
      app,
      socket,
      JSON.stringify({ type: 'events_api', envelope_id: 'e', payload: {} })
    );
    await manager.handleMessage(
      app,
      socket,
      JSON.stringify({ type: 'interactive', envelope_id: 'f', payload: {} })
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(socket.send).toHaveBeenCalledTimes(2);
  });
});

describe('connections', () => {
  it('opens a connection per app that has both tokens, and learns the bot identity', async () => {
    const id = await insertSlackApp(db, { bot_user_id: null, team_id: null });
    const { manager: m, fetchFn } = makeManager({ rows: [decryptedApp({ id })] });
    manager = m;
    await manager.sync();
    await connected();

    expect(fetchFn).toHaveBeenCalledWith(
      'https://slack.com/api/apps.connections.open',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer xapp-test' }),
      })
    );
    expect(FakeWebSocket.instances[0].url).toBe('wss://slack.test/1');
    expect(await db('slack_apps').where({ id }).first()).toMatchObject({
      bot_user_id: 'UBOT',
      team_id: 'T1',
      team_name: 'Futrou',
    });
  });

  it('skips apps without a bot token or an app token', async () => {
    ({ manager } = makeManager({
      rows: [
        decryptedApp({ id: 1, bot_token: null }),
        decryptedApp({ id: 2, app_token: null, name: 'other' }),
      ],
    }));
    await manager.sync();
    await new Promise((r) => setTimeout(r, 10));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('opens one connection per Slack app, even if two rows share an app token', async () => {
    ({ manager } = makeManager({
      rows: [decryptedApp({ id: 1 }), decryptedApp({ id: 2, name: 'copy' })],
    }));
    await manager.sync();
    await connected();
    await manager.sync();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects when the tokens change and closes connections of removed apps', async () => {
    const id = await insertSlackApp(db);
    const rows = [decryptedApp({ id })];
    const { manager: m } = makeManager({ rows });
    manager = m;
    await manager.sync();
    await connected();

    rows[0] = decryptedApp({ id, app_token: 'xapp-new' });
    await manager.sync();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    expect(FakeWebSocket.instances[0].closed).toBe(true);

    rows.length = 0;
    await manager.sync();
    expect(FakeWebSocket.instances[1].closed).toBe(true);
  });

  it('keeps the same connection while nothing changes', async () => {
    const id = await insertSlackApp(db);
    const { manager: m } = makeManager({ rows: [decryptedApp({ id })] });
    manager = m;
    await manager.sync();
    await connected();
    await manager.sync();
    await manager.sync();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].closed).toBe(false);
  });

  it('reconnects after the socket closes, backing off between failures', async () => {
    vi.useFakeTimers();
    const id = await insertSlackApp(db);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ ok: true, url: 'wss://a' }) })
      .mockResolvedValueOnce({ json: async () => ({ ok: false, error: 'invalid_auth' }) })
      .mockResolvedValue({ json: async () => ({ ok: true, url: 'wss://b' }) });
    ({ manager } = makeManager({ rows: [decryptedApp({ id })], fetchFn }));

    await manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].close(); // Slack hung up → retry after 1s, which fails…
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000); // …then 2s later it succeeds.
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toBe('wss://b');
  });

  it('retries when the bot identity lookup fails', async () => {
    vi.useFakeTimers();
    const id = await insertSlackApp(db);
    slack.authTest.mockRejectedValueOnce(new Error('invalid_auth'));
    ({ manager } = makeManager({ rows: [decryptedApp({ id })] }));
    await manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('does not reconnect after stop()', async () => {
    vi.useFakeTimers();
    const id = await insertSlackApp(db);
    ({ manager } = makeManager({ rows: [decryptedApp({ id })] }));
    await manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    manager.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('gives apps.connections.open an abort signal and retries when it times out', async () => {
    vi.useFakeTimers();
    const id = await insertSlackApp(db);
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
      .mockResolvedValue({ json: async () => ({ ok: true, url: 'wss://b' }) });
    ({ manager } = makeManager({ rows: [decryptedApp({ id })], fetchFn }));
    await manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(FakeWebSocket.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('opens no socket when stop() runs while the connection URL is still pending', async () => {
    const id = await insertSlackApp(db);
    let resolveFetch;
    const fetchFn = vi.fn().mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
    ({ manager } = makeManager({ rows: [decryptedApp({ id })], fetchFn }));
    await manager.sync();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());

    manager.stop();
    resolveFetch({ json: async () => ({ ok: true, url: 'wss://late' }) });
    await new Promise((r) => setTimeout(r, 10));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('opens no socket when stop() runs while the bot identity lookup is pending', async () => {
    const id = await insertSlackApp(db);
    let resolveAuth;
    slack.authTest.mockReturnValue(new Promise((resolve) => (resolveAuth = resolve)));
    const { manager: m, fetchFn } = makeManager({ rows: [decryptedApp({ id })] });
    manager = m;
    await manager.sync();
    await vi.waitFor(() => expect(slack.authTest).toHaveBeenCalled());

    manager.stop();
    resolveAuth({ userId: 'UBOT', teamId: 'T1', team: 'Futrou' });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('passes incoming events from the socket to the bot', async () => {
    const id = await insertSlackApp(db);
    const { manager: m, bot } = makeManager({ rows: [decryptedApp({ id })] });
    manager = m;
    await manager.sync();
    await connected();
    FakeWebSocket.instances[0].receive({
      type: 'events_api',
      envelope_id: 'e1',
      payload: { event_id: 'Ev1' },
    });
    await vi.waitFor(() => expect(bot.handleEventCallback).toHaveBeenCalled());
    expect(FakeWebSocket.instances[0].sent).toEqual([{ envelope_id: 'e1' }]);
  });
});

describe('seeding from .env', () => {
  const env = { SLACK_BOT_TOKEN: 'xoxb-env', SLACK_APP_TOKEN: 'xapp-env' };

  async function seed({ rows = [], vars = env } = {}) {
    const saved = { ...process.env };
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    Object.assign(process.env, vars);
    try {
      ({ manager } = makeManager({
        rows,
        fetchFn: vi.fn().mockRejectedValue(new Error('offline')),
      }));
      await manager.start();
      manager.stop();
    } finally {
      process.env = saved;
    }
    return db('slack_apps');
  }

  it('creates an app named "baguette"', async () => {
    expect((await seed()).map((r) => r.name)).toEqual(['baguette']);
  });

  it('does nothing without both variables', async () => {
    expect(await seed({ vars: { SLACK_BOT_TOKEN: 'xoxb-env' } })).toHaveLength(0);
    expect(await seed({ vars: {} })).toHaveLength(0);
  });

  it('does nothing when an app already uses that app token', async () => {
    expect(await seed({ rows: [{ name: 'mine', app_token: 'xapp-env' }] })).toHaveLength(0);
  });

  it('picks a free name when "baguette" is taken by a different app', async () => {
    const rows = await seed({ rows: [{ name: 'baguette', app_token: 'xapp-other' }] });
    expect(rows.map((r) => r.name)).toEqual(['baguette-2']);
  });
});
