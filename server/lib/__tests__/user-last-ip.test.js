import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import {
  countryFromEdgeHeaders,
  countryFromIpLookup,
  isPrivateOrLoopbackIp,
  resolveUserCountry,
  touchUserLastIp,
} from '../user-last-ip.js';

vi.mock('geoip-country', () => ({
  default: {
    lookup: vi.fn((ip) => {
      if (ip === '203.0.113.9') return { country: 'US' };
      return null;
    }),
  },
}));

describe('user-last-ip', () => {
  const db = createTestDb();

  beforeEach(async () => {
    vi.unstubAllEnvs();
    await db('users').delete();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function insertUser(overrides = {}) {
    const [id] = await db('users').insert({
      github_id: 1,
      username: 'alice',
      approved: true,
      ...overrides,
    });
    return id;
  }

  describe('isPrivateOrLoopbackIp', () => {
    it('treats loopback and RFC1918 as private', () => {
      expect(isPrivateOrLoopbackIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrLoopbackIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrLoopbackIp('192.168.1.5')).toBe(true);
      expect(isPrivateOrLoopbackIp('::1')).toBe(true);
      expect(isPrivateOrLoopbackIp('203.0.113.9')).toBe(false);
    });
  });

  describe('resolveUserCountry', () => {
    it('uses geoip and ignores spoofable edge headers by default', () => {
      expect(resolveUserCountry('203.0.113.9', { headers: { 'cf-ipcountry': 'FR' } })).toBe('US');
    });

    it('honors edge headers when TRUST_EDGE_COUNTRY is set', () => {
      vi.stubEnv('TRUST_EDGE_COUNTRY', '1');
      expect(resolveUserCountry('203.0.113.9', { headers: { 'cf-ipcountry': 'FR' } })).toBe('FR');
    });

    it('ignores XX and T1 edge headers even when trusted', () => {
      vi.stubEnv('TRUST_EDGE_COUNTRY', '1');
      expect(resolveUserCountry('203.0.113.9', { headers: { 'cf-ipcountry': 'XX' } })).toBe('US');
    });

    it('returns null country for private IPs', () => {
      expect(resolveUserCountry('127.0.0.1', undefined)).toBeNull();
      expect(countryFromIpLookup('127.0.0.1')).toBeNull();
    });

    it('reads cloudfront and appengine headers', () => {
      expect(countryFromEdgeHeaders({ headers: { 'cloudfront-viewer-country': 'de' } })).toBe('DE');
      expect(countryFromEdgeHeaders({ headers: { 'x-appengine-country': 'CA' } })).toBe('CA');
    });
  });

  describe('touchUserLastIp', () => {
    it('writes IP and country on first touch', async () => {
      const userId = await insertUser();
      const updated = await touchUserLastIp(db, userId, '203.0.113.9');
      expect(updated).toBe(true);
      const row = await db('users').where({ id: userId }).first();
      expect(row.last_ip).toBe('203.0.113.9');
      expect(row.last_ip_country).toBe('US');
      expect(row.last_seen_at).toBeTruthy();
    });

    it('debounces when IP unchanged and last_seen_at is recent', async () => {
      const userId = await insertUser();
      await touchUserLastIp(db, userId, '203.0.113.9');
      const rowAfterFirst = await db('users').where({ id: userId }).first();
      const second = await touchUserLastIp(db, userId, '203.0.113.9');
      expect(second).toBe(false);
      const rowAfterSecond = await db('users').where({ id: userId }).first();
      expect(rowAfterSecond.last_ip_country).toBe('US');
      expect(rowAfterSecond.last_seen_at).toEqual(rowAfterFirst.last_seen_at);
    });

    it('force bypasses debounce', async () => {
      vi.stubEnv('TRUST_EDGE_COUNTRY', '1');
      const userId = await insertUser();
      await touchUserLastIp(db, userId, '203.0.113.9', {
        headers: { 'cf-ipcountry': 'FR' },
      });
      const updated = await touchUserLastIp(
        db,
        userId,
        '203.0.113.9',
        { headers: { 'cf-ipcountry': 'DE' } },
        { force: true }
      );
      expect(updated).toBe(true);
      const row = await db('users').where({ id: userId }).first();
      expect(row.last_ip_country).toBe('DE');
    });

    it('updates when IP changes even within debounce window', async () => {
      const userId = await insertUser();
      await touchUserLastIp(db, userId, '203.0.113.9');
      const updated = await touchUserLastIp(db, userId, '198.51.100.2');
      expect(updated).toBe(true);
      const row = await db('users').where({ id: userId }).first();
      expect(row.last_ip).toBe('198.51.100.2');
      expect(row.last_ip_country).toBeNull();
    });
  });
});
