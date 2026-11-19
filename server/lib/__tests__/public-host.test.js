import { describe, it, expect } from 'vitest';
import {
  assertProductionDomainConfigured,
  resolvePublicHost,
  resolveSessionSubdomainPublicUrl,
  resolveUseHttps,
} from '../public-host.js';

describe('resolveUseHttps', () => {
  it('defaults to true in production and false otherwise', () => {
    expect(resolveUseHttps({ NODE_ENV: 'production' })).toBe(true);
    expect(resolveUseHttps({ NODE_ENV: 'development' })).toBe(false);
    expect(resolveUseHttps({})).toBe(false);
  });
});

describe('assertProductionDomainConfigured', () => {
  it('requires PUBLIC_HOST or DOMAIN in production', () => {
    expect(() => assertProductionDomainConfigured({ NODE_ENV: 'production' })).toThrow(
      /PUBLIC_HOST|DOMAIN/
    );
    expect(() =>
      assertProductionDomainConfigured({ NODE_ENV: 'production', DOMAIN: 'baguette.example.com' })
    ).not.toThrow();
    expect(() =>
      assertProductionDomainConfigured({
        NODE_ENV: 'production',
        PUBLIC_HOST: 'https://baguette.example.com',
      })
    ).not.toThrow();
  });
});

describe('resolvePublicHost', () => {
  it('prefers PUBLIC_HOST over DOMAIN', () => {
    expect(
      resolvePublicHost({
        PUBLIC_HOST: 'https://custom.example.com',
        DOMAIN: 'ignored.example.com',
      })
    ).toBe('https://custom.example.com');
  });

  it('uses https for production by default', () => {
    expect(resolvePublicHost({ NODE_ENV: 'production', DOMAIN: 'baguette.example.com' })).toBe(
      'https://www.baguette.example.com'
    );
  });

  it('uses http with port in development', () => {
    expect(resolvePublicHost({ NODE_ENV: 'development', DOMAIN: '127.0.0.1.traefik.me' })).toBe(
      'http://www.127.0.0.1.traefik.me:3000'
    );
  });
});

describe('resolveSessionSubdomainPublicUrl', () => {
  it('uses Express port for Vite dev without explicit PUBLIC_HOST', () => {
    const url = resolveSessionSubdomainPublicUrl({
      NODE_ENV: 'development',
      VITE_SERVER_ENABLED: 'true',
      DOMAIN: '127.0.0.1.traefik.me',
      PORT: '3000',
    });
    expect(url).toBe('http://www.127.0.0.1.traefik.me:3000');
    expect(url).not.toContain('localhost');
  });
});
