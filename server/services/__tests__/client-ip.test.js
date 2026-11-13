import { describe, it, expect } from 'vitest';
import { clientIpFrom, getClientIp } from '../../lib/client-ip.js';

describe('getClientIp', () => {
  it('trusts the rightmost X-Forwarded-For hop (the edge proxy’s entry)', () => {
    // A client can put anything in the first hop; the edge proxy appends the real address.
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    const req = { headers: {}, socket: { remoteAddress: '::ffff:192.168.1.5' } };
    expect(getClientIp(req)).toBe('192.168.1.5');
  });

  it('falls back to the socket address when no X-Forwarded-For header is present', () => {
    expect(clientIpFrom(undefined, '10.0.0.1')).toBe('10.0.0.1');
    expect(clientIpFrom('', '10.0.0.1')).toBe('10.0.0.1');
  });

  it('falls back to the socket address when fewer hops exist than are trusted', () => {
    expect(clientIpFrom('203.0.113.9', '10.0.0.1', 2)).toBe('10.0.0.1');
  });

  it('ignores the forwarded header entirely with zero trusted hops (direct exposure)', () => {
    expect(clientIpFrom('203.0.113.9', '10.0.0.1', 0)).toBe('10.0.0.1');
    expect(clientIpFrom('203.0.113.9, 198.51.100.7', '10.0.0.1', 0)).toBe('10.0.0.1');
  });

  it('trusts the Nth-from-right hop for N trusted proxies', () => {
    // Two proxies in front: client → edge → internal proxy → baguette.
    expect(clientIpFrom('203.0.113.9, 198.51.100.7, 10.0.0.2', '127.0.0.1', 2)).toBe(
      '198.51.100.7'
    );
  });

  it('strips IPv4-mapped IPv6 prefixes from forwarded addresses', () => {
    expect(clientIpFrom('::ffff:203.0.113.9', '10.0.0.1')).toBe('203.0.113.9');
  });

  it('returns an empty string when nothing is known', () => {
    expect(clientIpFrom(undefined, '')).toBe('');
    expect(clientIpFrom(undefined, undefined)).toBe('');
  });

  it('never returns a hop left of the trusted window (spoofed entries are ignored)', () => {
    // Attacker chain: client spoofs a private-looking address, edge proxy appends the truth.
    expect(clientIpFrom('127.0.0.1, 203.0.113.9', '10.0.0.1')).toBe('203.0.113.9');
  });
});
