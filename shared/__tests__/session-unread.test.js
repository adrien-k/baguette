import { describe, it, expect } from 'vitest';
import { sessionHasUnreadActivity, sessionNeedsLastViewedUpdate } from '../session-unread.js';

describe('sessionNeedsLastViewedUpdate', () => {
  it('is false when viewed at or after last activity', () => {
    expect(
      sessionNeedsLastViewedUpdate({
        last_activity_at: '2026-01-01T12:00:00.000Z',
        last_viewed_at: '2026-01-01T12:00:00.000Z',
      })
    ).toBe(false);
  });

  it('is true when last_viewed_at is before last_activity_at or missing', () => {
    expect(
      sessionNeedsLastViewedUpdate({
        last_activity_at: '2026-01-02T00:00:00.000Z',
        last_viewed_at: '2026-01-01T00:00:00.000Z',
      })
    ).toBe(true);
    expect(
      sessionNeedsLastViewedUpdate({
        last_activity_at: '2026-01-01T00:00:00.000Z',
        last_viewed_at: null,
      })
    ).toBe(true);
  });
});

describe('sessionHasUnreadActivity', () => {
  it('is false when viewed at or after last activity', () => {
    expect(
      sessionHasUnreadActivity({
        last_activity_at: '2026-01-01T12:00:00.000Z',
        last_viewed_at: '2026-01-01T12:00:00.000Z',
      })
    ).toBe(false);
    expect(
      sessionHasUnreadActivity({
        last_activity_at: '2026-01-01T12:00:00.000Z',
        last_viewed_at: '2026-01-02T00:00:00.000Z',
      })
    ).toBe(false);
  });

  it('is true when last_viewed_at is before last_activity_at or missing', () => {
    expect(
      sessionHasUnreadActivity({
        last_activity_at: '2026-01-02T00:00:00.000Z',
        last_viewed_at: '2026-01-01T00:00:00.000Z',
      })
    ).toBe(true);
    expect(
      sessionHasUnreadActivity({
        last_activity_at: '2026-01-01T00:00:00.000Z',
        last_viewed_at: null,
      })
    ).toBe(true);
  });

  it('is false for archived sessions', () => {
    expect(
      sessionHasUnreadActivity({
        archived_at: '2026-01-01T00:00:00.000Z',
        last_activity_at: '2026-01-02T00:00:00.000Z',
        last_viewed_at: null,
      })
    ).toBe(false);
  });
});
