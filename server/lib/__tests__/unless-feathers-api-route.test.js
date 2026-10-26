import { describe, it, expect, vi } from 'vitest';
import { unlessFeathersApiRoute } from '../unless-feathers-api-route.js';

describe('unlessFeathersApiRoute', () => {
  it('skips middleware for /api and /api/* paths', () => {
    const inner = vi.fn((req, res, next) => next());
    const wrapped = unlessFeathersApiRoute(inner);
    const next = vi.fn();

    wrapped({ originalUrl: '/api/sessions/1', url: '/sessions/1' }, {}, next);
    wrapped({ originalUrl: '/api/sse', url: '/sse' }, {}, next);
    wrapped({ originalUrl: '/api', url: '/' }, {}, next);

    expect(inner).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('runs middleware for non-API paths', () => {
    const inner = vi.fn((req, res, next) => next());
    const wrapped = unlessFeathersApiRoute(inner);
    const next = vi.fn();

    wrapped({ originalUrl: '/auth/callback', url: '/auth/callback' }, {}, next);

    expect(inner).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
