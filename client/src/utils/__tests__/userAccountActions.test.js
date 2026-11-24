import { describe, expect, it, vi } from 'vitest';
import { buildUserAccountActionItems } from '../userAccountActions.jsx';

const baseUser = { id: 2, admin: true, username: 'other' };

function build(overrides = {}) {
  return buildUserAccountActionItems({
    accountStatus: 'approved',
    u: baseUser,
    isOwner: false,
    isLastAdmin: false,
    currentUserOwner: true,
    inviteBusy: false,
    handlers: {
      onSetAdmin: vi.fn(),
      onTransferOwner: vi.fn(),
      onInvite: vi.fn(),
      onReject: vi.fn(),
      onApprove: vi.fn(),
    },
    ...overrides,
  });
}

describe('buildUserAccountActionItems', () => {
  it('includes transfer ownership for approved non-owners when viewer is owner', () => {
    const labels = build().map((i) => i.label);
    expect(labels).toContain('Transfer ownership');
    expect(labels).toContain('Revoke');
  });

  it('omits transfer ownership when viewer is not owner', () => {
    const labels = build({ currentUserOwner: false }).map((i) => i.label);
    expect(labels).not.toContain('Transfer ownership');
  });

  it('adds invite link only for invited accounts', () => {
    const invited = build({ accountStatus: 'invited', u: { id: 3, admin: false } }).map(
      (i) => i.label
    );
    expect(invited).toContain('New invite link');
    expect(invited).not.toContain('Revoke');

    const pending = build({ accountStatus: 'pending', u: { id: 3, admin: false } }).map(
      (i) => i.label
    );
    expect(pending).not.toContain('New invite link');
  });

  it('puts approve in menu for revoked users', () => {
    const labels = build({ accountStatus: 'revoked', u: { id: 3, admin: false } }).map(
      (i) => i.label
    );
    expect(labels).toContain('Approve');
    expect(labels).not.toContain('Revoke');
  });
});
