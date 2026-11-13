import { describe, it, expect } from 'vitest';

import {
  assertMcpDescription,
  assertMcpUrl,
  buildMcpEnableMap,
  buildMcpHeaders,
  toSdkMcpServer,
} from '../mcp-server-config.js';

describe('assertMcpDescription', () => {
  it('trims and normalizes empties', () => {
    expect(assertMcpDescription('  Use for fixtures.  ')).toBe('Use for fixtures.');
    expect(assertMcpDescription(null)).toBeNull();
    expect(assertMcpDescription(undefined)).toBeNull();
    expect(assertMcpDescription('   ')).toBeNull();
    expect(() => assertMcpDescription(42)).toThrow();
    expect(() => assertMcpDescription('a'.repeat(2001))).toThrow();
    expect(assertMcpDescription('a'.repeat(2000))).toBe('a'.repeat(2000));
  });
});

describe('buildMcpEnableMap', () => {
  const catalog = [
    { id: 1, enabled: 1 },
    { id: 2, enabled: 0 },
  ];

  it('fills defaults and applies overrides, dropping unknown ids', () => {
    expect(buildMcpEnableMap({ catalog, override: { 2: true, 9: true } })).toEqual({
      1: true,
      2: true,
    });
  });

  it('locks the snapshot so later catalog rows are not added', () => {
    expect(
      buildMcpEnableMap({
        catalog: [...catalog, { id: 3, enabled: 1 }],
        override: { 1: true },
        locked: true,
      })
    ).toEqual({ 1: true });
  });
});

describe('assertMcpUrl', () => {
  it('requires an http(s) URL and caps its length', () => {
    expect(() => assertMcpUrl('file:///tmp/mcp')).toThrow(/http or https/);
    expect(() => assertMcpUrl('javascript:alert(1)')).toThrow(/http or https/);
    expect(() => assertMcpUrl('https://' + 'a'.repeat(2100))).toThrow(/A valid http\(s\) URL/);
    expect(assertMcpUrl('http://127.0.0.1/mcp')).toBe('http://127.0.0.1/mcp');
    expect(assertMcpUrl('HTTP://Example.com/mcp')).toBe('http://example.com/mcp');
  });
});

describe('toSdkMcpServer', () => {
  it('never leaks the description into the SDK server config', () => {
    const config = toSdkMcpServer({
      transport: 'http',
      url: 'https://mcp.example/mcp',
      description: 'internal guidance',
    });
    expect(config).toEqual({ type: 'http', url: 'https://mcp.example/mcp' });
  });

  it('prefers an OAuth access token over a pasted bearer token', () => {
    const config = toSdkMcpServer({
      transport: 'sse',
      url: 'https://mcp.example/sse',
      bearer_token: 'pasted',
      headers: { 'X-Team': 'platform' },
      oauth_tokens: { access_token: 'oauth-token' },
    });
    expect(config).toEqual({
      type: 'sse',
      url: 'https://mcp.example/sse',
      headers: {
        'X-Team': 'platform',
        Authorization: 'Bearer oauth-token',
      },
    });
    expect(buildMcpHeaders({ bearer_token: 'pasted', headers: {} }).Authorization).toBe(
      'Bearer pasted'
    );
  });
});
