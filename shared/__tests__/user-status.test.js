import { describe, it, expect } from 'vitest';
import { isApprovedUser, resolveUserStatus } from '../user-status.js';

describe('resolveUserStatus', () => {
  it('prefers the status column', () => {
    expect(resolveUserStatus({ status: 'approved', approved: false })).toBe('approved');
    expect(resolveUserStatus({ status: 'pending' })).toBe('pending');
    expect(resolveUserStatus({ status: 'revoked' })).toBe('revoked');
  });

  it('falls back to legacy approved/revoked booleans', () => {
    expect(resolveUserStatus({ approved: true })).toBe('approved');
    expect(resolveUserStatus({ approved: 1 })).toBe('approved');
    expect(resolveUserStatus({ approved: false, revoked: true })).toBe('revoked');
    expect(resolveUserStatus({ approved: false })).toBe('pending');
    expect(resolveUserStatus(null)).toBe('pending');
  });
});

describe('isApprovedUser', () => {
  it('is true only for approved status', () => {
    expect(isApprovedUser({ status: 'approved' })).toBe(true);
    expect(isApprovedUser({ status: 'pending' })).toBe(false);
    expect(isApprovedUser({ status: 'revoked' })).toBe(false);
    expect(isApprovedUser({ approved: true })).toBe(true);
  });
});
