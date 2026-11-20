/**
 * Slack request signatures and expiring tokens.
 */
import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  looksLikeSlackSignature,
  readSlackToken,
  signSlackToken,
  verifySlackSignature,
} from '../slack-auth.js';

const SECRET = 'shhh-signing-secret';
const NOW_MS = 1_700_000_000_000;
const TIMESTAMP = String(NOW_MS / 1000);
const BODY = '{"type":"event_callback"}';

const sign = (body, timestamp, secret = SECRET) =>
  `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;

const verify = (overrides = {}) =>
  verifySlackSignature({
    signingSecret: SECRET,
    timestamp: TIMESTAMP,
    signature: sign(BODY, TIMESTAMP),
    rawBody: BODY,
    nowMs: NOW_MS,
    ...overrides,
  });

describe('verifySlackSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    expect(verify()).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verify({ rawBody: `${BODY} ` })).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    expect(verify({ signature: sign(BODY, TIMESTAMP, 'other-secret') })).toBe(false);
  });

  it('rejects a replayed (stale) request, and one from the future', () => {
    expect(verify({ nowMs: NOW_MS + 10 * 60 * 1000 })).toBe(false);
    expect(verify({ nowMs: NOW_MS - 10 * 60 * 1000 })).toBe(false);
  });

  it('accepts a request just inside the five minute window', () => {
    expect(verify({ nowMs: NOW_MS + 4 * 60 * 1000 })).toBe(true);
  });

  it.each([
    ['signing secret', { signingSecret: null }],
    ['timestamp', { timestamp: undefined }],
    ['signature', { signature: '' }],
    ['raw body', { rawBody: '' }],
  ])('rejects when the %s is missing', (_name, overrides) => {
    expect(verify(overrides)).toBe(false);
  });

  it('rejects a non-numeric timestamp and a signature of the wrong length', () => {
    expect(verify({ timestamp: 'yesterday' })).toBe(false);
    expect(verify({ signature: 'v0=abc' })).toBe(false);
  });

  it('defaults "now" to the current time', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        signature: sign(BODY, timestamp),
        rawBody: BODY,
      })
    ).toBe(true);
  });
});

describe('signSlackToken / readSlackToken', () => {
  afterEach(() => vi.useRealTimers());

  it('round-trips a payload', () => {
    expect(readSlackToken(signSlackToken({ slack_user_id: 'U1' }))).toMatchObject({
      slack_user_id: 'U1',
    });
  });

  it('is URL safe', () => {
    expect(signSlackToken({ a: 1 })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects garbage, a tampered token and nothing at all', () => {
    const token = signSlackToken({ a: 1 });
    expect(readSlackToken('not-a-token')).toBeNull();
    expect(readSlackToken(`${token.slice(0, -4)}AAAA`)).toBeNull();
    expect(readSlackToken(undefined)).toBeNull();
  });

  it('expires after 30 minutes', () => {
    vi.useFakeTimers();
    const token = signSlackToken({ a: 1 });
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(readSlackToken(token)).not.toBeNull();
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(readSlackToken(token)).toBeNull();
  });
});

describe('looksLikeSlackSignature', () => {
  const valid = sign(BODY, TIMESTAMP);
  const check = (overrides = {}) =>
    looksLikeSlackSignature({
      timestamp: TIMESTAMP,
      signature: valid,
      nowMs: NOW_MS,
      ...overrides,
    });

  it('accepts a well-formed, fresh signature (without checking it is right)', () => {
    expect(check()).toBe(true);
    expect(check({ signature: sign('other body', TIMESTAMP, 'other secret') })).toBe(true);
  });

  it.each([
    ['missing timestamp', { timestamp: undefined }],
    ['non-numeric timestamp', { timestamp: 'yesterday' }],
    ['float timestamp', { timestamp: '1.5' }],
    ['stale timestamp', { timestamp: String(NOW_MS / 1000 - 3600) }],
    ['future timestamp', { timestamp: String(NOW_MS / 1000 + 3600) }],
    ['missing signature', { signature: undefined }],
    ['wrong version', { signature: valid.replace('v0=', 'v1=') }],
    ['short signature', { signature: 'v0=bad' }],
    ['non-hex signature', { signature: `v0=${'z'.repeat(64)}` }],
    ['upper-case hex', { signature: valid.toUpperCase().replace('V0=', 'v0=') }],
  ])('rejects %s', (_name, overrides) => {
    expect(check(overrides)).toBe(false);
  });
});
