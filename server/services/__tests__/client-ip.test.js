import { describe, it, expect } from 'vitest';
import { getClientIp } from '../../lib/client-ip.js';

describe('getClientIp', () => {
  it('uses the first X-Forwarded-For hop', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(getClientIp(req)).toBe('203.0.113.1');
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    const req = { headers: {}, socket: { remoteAddress: '::ffff:192.168.1.5' } };
    expect(getClientIp(req)).toBe('192.168.1.5');
  });
});
