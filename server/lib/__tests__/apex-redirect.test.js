import { describe, expect, it, vi } from 'vitest';
import {
  createApexRedirect,
  getApexFromPublicHost,
  hostnameFromHostHeader,
} from '../apex-redirect.js';

function runMiddleware(middleware, { host, url = '/path?x=1', hostname }) {
  const req = { url, headers: host === undefined ? {} : { host }, hostname };
  const res = { redirect: vi.fn() };
  const next = vi.fn();
  middleware(req, res, next);
  return { req, res, next };
}

describe('hostnameFromHostHeader', () => {
  it('lowercases and strips the port', () => {
    expect(hostnameFromHostHeader('Baguette.example.COM:8443')).toBe('baguette.example.com');
  });

  it('returns null for empty, missing, or malformed input', () => {
    expect(hostnameFromHostHeader('')).toBe(null);
    expect(hostnameFromHostHeader('   ')).toBe(null);
    expect(hostnameFromHostHeader(null)).toBe(null);
    expect(hostnameFromHostHeader(undefined)).toBe(null);
  });
});

describe('getApexFromPublicHost', () => {
  it('strips the www prefix', () => {
    expect(getApexFromPublicHost('https://www.baguette.example.com')).toBe('baguette.example.com');
  });

  it('keeps trailing path/slash out of the apex', () => {
    expect(getApexFromPublicHost('https://www.baguette.example.com/')).toBe('baguette.example.com');
  });

  it('returns null without a www prefix', () => {
    expect(getApexFromPublicHost('https://baguette.example.com')).toBe(null);
    expect(getApexFromPublicHost('http://localhost:5173')).toBe(null);
    expect(getApexFromPublicHost('not a url')).toBe(null);
  });
});

describe('createApexRedirect', () => {
  it('301s the bare apex to the www host, preserving path and query', () => {
    const middleware = createApexRedirect({ publicHost: 'https://www.baguette.example.com' });
    const { res, next } = runMiddleware(middleware, {
      host: 'baguette.example.com',
      url: '/sessions/42?tab=logs',
    });
    expect(res.redirect).toHaveBeenCalledWith(
      301,
      'https://www.baguette.example.com/sessions/42?tab=logs'
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('normalizes non-lowercase hosts and attached ports', () => {
    const middleware = createApexRedirect({ publicHost: 'https://www.baguette.example.com' });
    const { res } = runMiddleware(middleware, { host: 'BAGUETTE.Example.com:443', url: '/' });
    expect(res.redirect).toHaveBeenCalledWith(301, 'https://www.baguette.example.com/');
  });

  it('leaves the www host and session preview subdomains untouched', () => {
    const middleware = createApexRedirect({ publicHost: 'https://www.baguette.example.com' });
    for (const host of ['www.baguette.example.com', 'session-abc123.baguette.example.com']) {
      const { res, next } = runMiddleware(middleware, { host });
      expect(res.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('passes unrelated hosts through', () => {
    const middleware = createApexRedirect({ publicHost: 'https://www.baguette.example.com' });
    const { res, next } = runMiddleware(middleware, { host: 'other.example.com' });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no Host header', () => {
    const middleware = createApexRedirect({ publicHost: 'https://www.baguette.example.com' });
    const { res, next } = runMiddleware(middleware, { host: undefined });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when PUBLIC_HOST has no www prefix', () => {
    const middleware = createApexRedirect({ publicHost: 'http://localhost:5173' });
    const { res, next } = runMiddleware(middleware, { host: 'localhost' });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('trims a trailing slash from the redirect target', () => {
    const middleware = createApexRedirect({ publicHost: 'https://www.baguette.example.com/' });
    const { res } = runMiddleware(middleware, { host: 'baguette.example.com', url: '/admin' });
    expect(res.redirect).toHaveBeenCalledWith(301, 'https://www.baguette.example.com/admin');
  });
});
