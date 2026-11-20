import { describe, it, expect } from 'vitest';
import { requirePublicService } from '../feathers/public-services.js';

describe('requirePublicService', () => {
  /** The Details tab fetches session images from the browser — must stay reachable. */
  it('allows external calls to session-images (image placeholders resolve client-side)', () => {
    const context = { params: { provider: 'rest' }, path: 'session-images' };
    expect(requirePublicService(context)).toBe(context);
  });

  it('rejects external calls to services that are not declared public', () => {
    const context = { params: { provider: 'rest' }, path: 'not-a-public-service' };
    expect(() => requirePublicService(context)).toThrow(/not accessible externally/);
  });

  it('passes internal calls regardless of path', () => {
    const context = { params: {}, path: 'not-a-public-service' };
    expect(requirePublicService(context)).toBe(context);
  });
});
