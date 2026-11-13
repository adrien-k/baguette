import { describe, it, expect, beforeEach } from 'vitest';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { encrypt } from '../../lib/encrypt.js';
import { registerMcpServersService } from '../feathers/mcp-servers.service.js';
import {
  loadEnabledMcpServersForSession,
  sessionMcpPromptServers,
  writePiUserMcpConfig,
} from '../user-mcp-runtime.js';

const db = createTestDb();

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerMcpServersService(app);
  return app;
}

let app;
let userId;

beforeEach(async () => {
  await db('users').insert({ github_id: 1, username: 'alice', status: 'approved' });
  userId = (await db('users').where({ username: 'alice' }).first()).id;
  app = makeApp();
  await app.setup();
});

describe('loadEnabledMcpServersForSession', () => {
  it('embeds the description only when asked (withDescription)', async () => {
    const [onId] = await db('user_mcp_servers').insert({
      user_id: userId,
      name: 'docs',
      transport: 'http',
      url: 'https://mcp.example/docs',
      enabled: 1,
      description: 'Query the fixture store instead of writing SQL by hand.',
    });
    const session = {
      id: 4,
      user_id: userId,
      mcp_servers: JSON.stringify({ [onId]: true }),
    };
    const plain = await loadEnabledMcpServersForSession(app, session);
    expect(plain.docs).toEqual({ type: 'http', url: 'https://mcp.example/docs' });
    const described = await loadEnabledMcpServersForSession(app, session, {
      withDescription: true,
    });
    expect(described.docs).toEqual({
      type: 'http',
      url: 'https://mcp.example/docs',
      description: 'Query the fixture store instead of writing SQL by hand.',
    });
  });

  it('returns only servers the session snapshot enables', async () => {
    const [onId] = await db('user_mcp_servers').insert({
      user_id: userId,
      name: 'docs',
      transport: 'http',
      url: 'https://mcp.example/docs',
      enabled: 1,
      bearer_token_encrypted: encrypt('secret'),
    });
    const [offId] = await db('user_mcp_servers').insert({
      user_id: userId,
      name: 'logs',
      transport: 'http',
      url: 'https://mcp.example/logs',
      enabled: 1,
    });
    const servers = await loadEnabledMcpServersForSession(app, {
      id: 4,
      user_id: userId,
      mcp_servers: JSON.stringify({ [onId]: true, [offId]: false }),
    });
    expect(servers).toEqual({
      docs: {
        type: 'http',
        url: 'https://mcp.example/docs',
        headers: { Authorization: 'Bearer secret' },
      },
    });
  });

  it('returns an empty map when nothing is enabled', async () => {
    const servers = await loadEnabledMcpServersForSession(app, {
      id: 4,
      user_id: userId,
      mcp_servers: null,
    });
    expect(servers).toEqual({});
  });
});

describe('writePiUserMcpConfig', () => {
  it('writes mcp.json and removes it when the set is empty', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baguette-mcp-'));
    const mcpPath = path.join(dir, 'mcp.json');
    await fs.writeFile(mcpPath, 'old', { mode: 0o644 });
    await writePiUserMcpConfig(dir, {
      docs: { type: 'http', url: 'https://mcp.example/docs' },
    });
    const written = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
    expect(written.mcpServers.docs.url).toBe('https://mcp.example/docs');
    expect((await fs.stat(mcpPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    await writePiUserMcpConfig(dir, {});
    await expect(fs.access(path.join(dir, 'mcp.json'))).rejects.toThrow();
  });

  it('omits SSE servers that Pi rejects', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baguette-mcp-'));
    await writePiUserMcpConfig(dir, {
      docs: { type: 'http', url: 'https://mcp.example/docs' },
      events: { type: 'sse', url: 'https://mcp.example/sse' },
    });
    const written = JSON.parse(await fs.readFile(path.join(dir, 'mcp.json'), 'utf8'));
    expect(written.mcpServers.docs.url).toBe('https://mcp.example/docs');
    expect(written.mcpServers.events).toBeUndefined();

    await writePiUserMcpConfig(dir, {
      events: { type: 'sse', url: 'https://mcp.example/sse' },
    });
    await expect(fs.access(path.join(dir, 'mcp.json'))).rejects.toThrow();
  });
});

describe('sessionMcpPromptServers', () => {
  let onId;
  let offId;

  beforeEach(async () => {
    [onId] = await db('user_mcp_servers').insert({
      user_id: userId,
      name: 'fabricate',
      transport: 'http',
      url: 'https://mcp.example/fabricate',
      enabled: 1,
      description: 'Build realistic test fixtures when the task needs seeded data.',
    });
    [offId] = await db('user_mcp_servers').insert({
      user_id: userId,
      name: 'events',
      transport: 'sse',
      url: 'https://mcp.example/sse',
      enabled: 1,
    });
  });

  it('returns enabled snapshot servers with their descriptions', async () => {
    const infos = await sessionMcpPromptServers(db, {
      id: 4,
      user_id: userId,
      mcp_servers: JSON.stringify({ [onId]: true, [offId]: true }),
    });
    expect(infos).toEqual([
      {
        id: onId,
        name: 'fabricate',
        transport: 'http',
        description: 'Build realistic test fixtures when the task needs seeded data.',
      },
      { id: offId, name: 'events', transport: 'sse', description: '' },
    ]);
  });

  it('returns empty when nothing is enabled, no user, or no db', async () => {
    expect(
      await sessionMcpPromptServers(db, { id: 4, user_id: userId, mcp_servers: null })
    ).toEqual([]);
    expect(
      await sessionMcpPromptServers(db, { id: 4, mcp_servers: JSON.stringify({ [onId]: true }) })
    ).toEqual([]);
    expect(
      await sessionMcpPromptServers(null, {
        id: 4,
        user_id: userId,
        mcp_servers: JSON.stringify({ [onId]: true }),
      })
    ).toEqual([]);
  });
});
