import { buildMcpEnableMap, parseMcpServersMap } from './mcp-server-config.js';

async function catalogForUser(db, userId) {
  if (!userId) return [];
  return db('user_mcp_servers').where({ user_id: userId }).select('id', 'enabled');
}

/**
 * JSON column value for sessions.mcp_servers / loops.mcp_servers.
 * Create fills defaults then applies overrides. Locked (loop runs, and patches)
 * does not add servers that were not already in the snapshot.
 */
export async function sessionMcpServersColumn(db, userId, { override, locked, existing } = {}) {
  const catalog = await catalogForUser(db, userId);
  if (existing !== undefined) {
    const merged = {
      ...parseMcpServersMap(existing),
      ...parseMcpServersMap(override),
    };
    return JSON.stringify(buildMcpEnableMap({ catalog, override: merged, locked: true }));
  }
  const map = buildMcpEnableMap({
    catalog,
    override: override == null ? null : parseMcpServersMap(override),
    locked: !!locked,
  });
  return JSON.stringify(map);
}
