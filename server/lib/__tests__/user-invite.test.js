import { describe, expect, it } from 'vitest';
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TOKEN_PREFIX,
  INVITE_TTL_MS,
  inviteExpiresAt,
  inviteUrlForToken,
  isInviteExpired,
} from '../user-invite.js';

describe('user-invite', () => {
  it('hashes tokens as sha256 hex and prefixes generated tokens', () => {
    const token = generateInviteToken();
    expect(token.startsWith(INVITE_TOKEN_PREFIX)).toBe(true);
    expect(hashInviteToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(`${token}x`)).not.toBe(hashInviteToken(token));
  });

  it('builds an invite URL from PUBLIC_HOST', () => {
    expect(inviteUrlForToken('bginv_abc')).toMatch(/\/invite\/bginv_abc$/);
  });

  it('treats invites as expired after expires_at', () => {
    const expires_at = inviteExpiresAt(1_000);
    expect(isInviteExpired({ invite_expires_at: expires_at }, 1_000 + INVITE_TTL_MS - 1)).toBe(
      false
    );
    expect(isInviteExpired({ invite_expires_at: expires_at }, 1_000 + INVITE_TTL_MS + 1)).toBe(
      true
    );
    expect(isInviteExpired({ invite_expires_at: null })).toBe(false);
  });
});
