import crypto from 'crypto';
import { decrypt } from '../lib/encrypt.js';

function timingSafeEqualStrings(a, b) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Resolve the user for an MCP Bearer token. Scans users with a stored token (fine for self-hosted scale).
 */
export async function findUserByMcpToken(db, token) {
  if (!token) return null;
  const rows = await db('users')
    .whereNotNull('mcp_api_token_encrypted')
    .select('id', 'mcp_api_token_encrypted', 'approved');
  for (const row of rows) {
    try {
      const stored = decrypt(row.mcp_api_token_encrypted);
      if (timingSafeEqualStrings(stored, token)) {
        return row;
      }
    } catch {
      /* skip corrupt row */
    }
  }
  return null;
}

export function parseBearerToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}
