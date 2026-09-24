import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { encrypt } from '../../lib/encrypt.js';
import { findUserByMcpToken } from '../mcp-auth.js';

const db = createTestDb({ beforeEach, afterEach });

describe('mcp-auth', () => {
  let userId;

  beforeEach(async () => {
    const [id] = await db('users').insert({
      github_id: Date.now(),
      username: 'mcp-test',
      approved: true,
    });
    userId = id;
  });

  it('finds user by valid MCP token', async () => {
    const token = 'bgmcp_test_token_value';
    await db('users')
      .where({ id: userId })
      .update({ mcp_api_token_encrypted: encrypt(token) });
    const row = await findUserByMcpToken(db, token);
    expect(row?.id).toBe(userId);
  });

  it('returns null for wrong token', async () => {
    await db('users')
      .where({ id: userId })
      .update({ mcp_api_token_encrypted: encrypt('bgmcp_real') });
    const row = await findUserByMcpToken(db, 'bgmcp_wrong');
    expect(row).toBeNull();
  });
});
