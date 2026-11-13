import { describe, it, expect } from 'vitest';
import { unapprovedAccountError, unapprovedPreviewDenial } from '../unapproved-account.js';

describe('unapprovedAccountError', () => {
  it('uses the pending message for pending status', () => {
    expect(unapprovedAccountError({ status: 'pending' })).toBe('Account pending approval');
    expect(unapprovedAccountError({ approved: false })).toBe('Account pending approval');
  });

  it('uses the revoked message for revoked status', () => {
    expect(unapprovedAccountError({ status: 'revoked' })).toBe('Account access has been revoked');
    expect(unapprovedAccountError({ approved: false, revoked: true })).toBe(
      'Account access has been revoked'
    );
  });
});

describe('unapprovedPreviewDenial', () => {
  it('returns pending copy for an unapproved account', () => {
    expect(unapprovedPreviewDenial({ status: 'pending' })).toEqual({
      title: 'Account pending approval',
      message: 'An existing user must approve this account before previews can be opened.',
    });
  });

  it('returns revoked copy when the account was rejected', () => {
    expect(unapprovedPreviewDenial({ status: 'revoked' })).toEqual({
      title: 'Account access revoked',
      message: 'This account can no longer open previews.',
    });
  });
});
