/**
 * Unit tests for preview token signing/verification, host extraction, and URL helpers.
 * Also covers the portal auth-URL construction that was previously double-slashing.
 */
import { describe, it, expect, vi } from 'vitest';

// Set env before importing modules that read it at load time
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.PUBLIC_API_HOST = 'https://preview.example.com';

const {
  signProxyToken,
  verifyProxyToken,
  extractSessionIdFromHost,
  getPreviewHost,
  getServicePreviewHost,
} = await import('../preview.js');

// ── signProxyToken / verifyProxyToken ────────────────────────────────────────

describe('signProxyToken / verifyProxyToken', () => {
  it('round-trips a userId correctly', () => {
    const token = signProxyToken(42);
    expect(verifyProxyToken(token)).toBe(42);
  });

  it('rejects a token with a tampered payload', () => {
    const token = signProxyToken(42);
    const [encoded, sig] = token.split('.');
    const tampered = encoded.slice(0, -1) + (encoded.at(-1) === 'a' ? 'b' : 'a');
    expect(() => verifyProxyToken(`${tampered}.${sig}`)).toThrow('Invalid signature');
  });

  it('rejects a token with a tampered signature', () => {
    const token = signProxyToken(42);
    const lastDot = token.lastIndexOf('.');
    const encoded = token.slice(0, lastDot);
    expect(() => verifyProxyToken(`${encoded}.invalidsig`)).toThrow();
  });

  it('rejects a token with no dot separator', () => {
    expect(() => verifyProxyToken('nodottoken')).toThrow('Invalid token format');
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();
    const token = signProxyToken(99);
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(() => verifyProxyToken(token)).toThrow('Token expired');
    vi.useRealTimers();
  });
});

// ── extractSessionIdFromHost ─────────────────────────────────────────────────

describe('extractSessionIdFromHost', () => {
  it('returns shortId and null serviceName for the portal subdomain', () => {
    expect(extractSessionIdFromHost('session-abc123.preview.example.com')).toEqual({
      shortId: 'abc123',
      serviceName: null,
    });
  });

  it('returns shortId and serviceName for a service subdomain', () => {
    expect(extractSessionIdFromHost('session-abc123-api.preview.example.com')).toEqual({
      shortId: 'abc123',
      serviceName: 'api',
    });
  });

  it('handles multi-word service names with hyphens', () => {
    expect(extractSessionIdFromHost('session-abc123-my-service.example.com')).toEqual({
      shortId: 'abc123',
      serviceName: 'my-service',
    });
  });

  it('returns null for a non-session host', () => {
    expect(extractSessionIdFromHost('preview.example.com')).toBeNull();
    expect(extractSessionIdFromHost('localhost:3000')).toBeNull();
  });

  it('requires at least 4 hex chars for shortId', () => {
    expect(extractSessionIdFromHost('session-abc.example.com')).toBeNull();
    expect(extractSessionIdFromHost('session-abcd.example.com')).not.toBeNull();
  });
});

// ── getPreviewHost / getServicePreviewHost ────────────────────────────────────

describe('getPreviewHost', () => {
  it('returns the portal subdomain URL', () => {
    const url = getPreviewHost('abc123');
    expect(url).toBe('https://session-abc123.preview.example.com/');
  });
});

describe('getServicePreviewHost', () => {
  it('returns the service subdomain URL', () => {
    const url = getServicePreviewHost('abc123', 'api');
    expect(url).toBe('https://session-abc123-api.preview.example.com/');
  });

  it('URL ends with a single slash (no double-slash when appending _baguette/auth)', () => {
    const url = getServicePreviewHost('abc123', 'web');
    // The portal template appends _baguette/auth (no leading slash).
    // Verify that the URL ends with exactly one slash so the path is correct.
    expect(url.endsWith('/')).toBe(true);
    const authUrl = `${url}_baguette/auth`;
    expect(new URL(authUrl).pathname).toBe('/_baguette/auth');
  });
});

// ── Portal auth URL construction ─────────────────────────────────────────────

describe('portal auth URL construction', () => {
  it('does not produce a double-slash when building the auth URL', () => {
    // Simulates what portal.ejs does: svc.url + '_baguette/auth?sign=...'
    // (the old bug used svc.url + '/_baguette/auth', producing '//')
    const svcUrl = getServicePreviewHost('abc123', 'api');
    const authUrl = `${svcUrl}_baguette/auth?sign=token`;
    expect(authUrl).not.toContain('//_baguette');
    expect(new URL(authUrl).pathname).toBe('/_baguette/auth');
  });

  it('each service gets a distinct auth URL', () => {
    const apiUrl = getServicePreviewHost('abc123', 'api');
    const webUrl = getServicePreviewHost('abc123', 'web');
    expect(apiUrl).not.toBe(webUrl);
    expect(apiUrl).toContain('-api.');
    expect(webUrl).toContain('-web.');
  });
});
