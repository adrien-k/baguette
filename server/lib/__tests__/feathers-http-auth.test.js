import { describe, it, expect, vi } from 'vitest';
import { sign } from 'cookie-signature';
import { createFeathersCookieAuth, getClientIpFromHeaders } from '../feathers-http-auth.js';
import { ENCRYPTION_KEY } from '../../config.js';

function makeContext({ headers = {}, params = {} } = {}) {
  return {
    request: { headers: new Headers(headers) },
    params: { ...params },
  };
}

function signedUserCookie(userId) {
  return `userId=s:${sign(String(userId), ENCRYPTION_KEY)}`;
}

describe('getClientIpFromHeaders', () => {
  it('uses the first X-Forwarded-For hop', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' });
    expect(getClientIpFromHeaders(headers)).toBe('203.0.113.1');
  });

  it('returns empty string when there is no forwarded header', () => {
    expect(getClientIpFromHeaders(new Headers())).toBe('');
  });
});

describe('createFeathersCookieAuth', () => {
  it('keeps adapter-provided clientIp when headers have no X-Forwarded-For', async () => {
    const get = vi.fn();
    const middleware = createFeathersCookieAuth({ service: () => ({ get }) });
    const context = makeContext({ params: { clientIp: '127.0.0.1' } });

    await middleware(context, async () => {});

    expect(context.params.clientIp).toBe('127.0.0.1');
    expect(get).not.toHaveBeenCalled();
  });

  it('falls back to X-Forwarded-For when clientIp is not already set', async () => {
    const middleware = createFeathersCookieAuth({ service: () => ({ get: vi.fn() }) });
    const context = makeContext({
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });

    await middleware(context, async () => {});

    expect(context.params.clientIp).toBe('203.0.113.9');
  });

  it('skips users.get when Express already attached an approved user', async () => {
    const get = vi.fn();
    const middleware = createFeathersCookieAuth({ service: () => ({ get }) });
    const user = { id: 7, approved: true };
    const context = makeContext({
      headers: { cookie: signedUserCookie(7) },
      params: { user, clientIp: '10.0.0.8' },
    });

    await middleware(context, async () => {});

    expect(get).not.toHaveBeenCalled();
    expect(context.params.user).toBe(user);
    expect(context.params.clientIp).toBe('10.0.0.8');
  });

  it('loads an approved user from the signed cookie when params.user is missing', async () => {
    const user = { id: 3, approved: true };
    const get = vi.fn().mockResolvedValue(user);
    const middleware = createFeathersCookieAuth({
      service: (name) => {
        expect(name).toBe('users');
        return { get };
      },
    });
    const context = makeContext({
      headers: { cookie: signedUserCookie(3) },
    });

    await middleware(context, async () => {});

    expect(get).toHaveBeenCalledWith('3', {});
    expect(context.params.user).toBe(user);
  });
});
