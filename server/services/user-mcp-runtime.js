import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import logger from '../logger.js';
import {
  accessTokenExpired,
  decryptMcpServerRow,
  mcpFlagEnabled,
  parseMcpServersMap,
  toSdkMcpServer,
} from './mcp-server-config.js';

async function prepareEnabledMcpServer(app, row) {
  const service = app.service?.('mcp-servers');
  let decrypted = decryptMcpServerRow(row);
  const tokens = decrypted.oauth_tokens;
  const shouldRefresh =
    tokens && (accessTokenExpired(tokens) || !tokens.access_token) && tokens.refresh_token;
  if (shouldRefresh && typeof service?.refreshOAuthIfNeeded === 'function') {
    decrypted = await service.refreshOAuthIfNeeded(decrypted);
  }
  if (!decrypted?.name || !decrypted.url) return null;
  return [decrypted.name, toSdkMcpServer(decrypted), decrypted];
}

function enabledMcpServerIds(session) {
  const map = parseMcpServersMap(session?.mcp_servers);
  return Object.entries(map)
    .filter(([, enabled]) => mcpFlagEnabled(enabled))
    .map(([id]) => Number(id))
    .filter((id) => Number.isFinite(id));
}

/**
 * Enabled user MCP servers for a session, as SDK `mcpServers` entries.
 * OAuth access tokens are refreshed when they are near expiry. Hosts are
 * resolved together, with a short DNS deadline, so one stuck resolver cannot
 * stall the turn. A server that cannot be prepared is skipped.
 *
 * `withDescription: true` (Pi only) also embeds the user's description in each
 * entry — pi's config schema accepts it. Claude and Cursor receive the raw
 * shape so unknown keys cannot trip their SDK option validation.
 */
export async function loadEnabledMcpServersForSession(
  app,
  session,
  { withDescription = false } = {}
) {
  try {
    const enabledIds = enabledMcpServerIds(session);
    if (!enabledIds.length || !session?.user_id) return {};

    const db = app.get('db');
    const rows = await db('user_mcp_servers')
      .where({ user_id: session.user_id })
      .whereIn('id', enabledIds);
    const prepared = await Promise.all(
      rows.map(async (row) => {
        try {
          return await prepareEnabledMcpServer(app, row);
        } catch (err) {
          logger.warn(
            { err: err?.message, sessionId: session.id, serverId: row.id },
            'Skipping user MCP server'
          );
          return null;
        }
      })
    );
    const out = {};
    for (const entry of prepared) {
      if (!entry) continue;
      const [name, config, decrypted] = entry;
      let value = config;
      if (withDescription && decrypted.description) {
        value = { ...config, description: decrypted.description };
      }
      out[name] = value;
    }
    return out;
  } catch (err) {
    logger.warn(
      { err: err?.message, sessionId: session?.id },
      'User MCP servers unavailable for this turn'
    );
    return {};
  }
}

/**
 * Name, transport, and description for the servers enabled by a session's
 * `mcp_servers` snapshot, without decryption or connectivity work: the prompt
 * section only needs the guidance text, not the runtime attachments.
 * Missing DB or rows degrade to an empty list, like the runtime loader.
 */
export async function sessionMcpPromptServers(db, session) {
  try {
    const enabledIds = enabledMcpServerIds(session);
    if (!enabledIds.length || !session?.user_id || !db) return [];
    const rows = await db('user_mcp_servers')
      .where({ user_id: session.user_id })
      .whereIn('id', enabledIds);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      transport: row.transport,
      description: row.description ?? '',
    }));
  } catch (err) {
    logger.warn(
      { err: err?.message, sessionId: session?.id },
      'MCP server descriptions unavailable for this turn'
    );
    return [];
  }
}

/**
 * Pi reads `{agentDir}/mcp.json` through the session's MCP extension
 * (`readPiUserMcpConfig`). Its loader accepts `http` and `streamable-http` and
 * rejects `sse`, so SSE entries are omitted. A stale file is removed when the
 * set is empty.
 *
 * Entries carry `exposure: "direct"`: pi's default exposure (`codemode`) only
 * makes the tools callable from codemode scripts and withholds them from the
 * model, and SDK sessions do not load codemode or tool_search. With `direct`
 * the `mcp__<server>__*` tools are declared beside the built-in tools, like on
 * Claude and Cursor turns.
 */
export async function writePiUserMcpConfig(agentDir, servers) {
  if (!agentDir) return;
  const file = path.join(agentDir, 'mcp.json');
  const mcpServers = {};
  const skippedSse = [];
  for (const [name, config] of Object.entries(servers || {})) {
    if (config?.type === 'sse') {
      skippedSse.push(name);
      continue;
    }
    mcpServers[name] = { ...config, exposure: 'direct' };
  }
  if (skippedSse.length) {
    logger.warn({ servers: skippedSse }, 'Pi does not support SSE MCP servers; skipping');
  }
  if (!Object.keys(mcpServers).length) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await chmod(agentDir, 0o700);
  await writeFile(file, `${JSON.stringify({ mcpServers }, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

/**
 * `{ servers, errors }` in the pi MCP extension's `LoadedMcpConfig` shape, read
 * from `{agentDir}/mcp.json` — the same file `writePiUserMcpConfig` writes.
 *
 * `createMcpExtension()`'s default loader reads only the global pi agent dir
 * (`getAgentDir()`), not the SDK resource loader's per-session `agentDir`, so
 * the Pi agent service passes a `loadConfig` option that calls this instead.
 * A missing file yields no servers; malformed content yields error strings
 * that the extension reports once at startup instead of failing the turn.
 */
export function readPiUserMcpConfig(agentDir) {
  if (!agentDir) return { servers: [], errors: [] };
  const file = path.join(agentDir, 'mcp.json');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return { servers: [], errors: [] };
    return { servers: [], errors: [`${file}: ${err?.message || String(err)}`] };
  }
  const entries = parsed?.mcpServers;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return { servers: [], errors: [`${file}: "mcpServers" must be an object`] };
  }
  const servers = [];
  const errors = [];
  for (const [name, config] of Object.entries(entries)) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      errors.push(`${file}: server "${name}" must be an object`);
      continue;
    }
    servers.push({ name, config, source: file, scope: 'global' });
  }
  return { servers, errors };
}
