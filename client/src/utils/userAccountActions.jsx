/**
 * @typedef {'invited' | 'pending' | 'approved' | 'revoked'} UserAccountUiStatus
 */

/**
 * @param {{
 *   accountStatus: UserAccountUiStatus,
 *   u: { id: number, admin?: boolean },
 *   isOwner: boolean,
 *   isLastAdmin: boolean,
 *   currentUserOwner: boolean,
 *   inviteBusy: boolean,
 *   handlers: {
 *     onSetAdmin: (id: number, admin: boolean) => void,
 *     onTransferOwner: (u: object) => void,
 *     onInvite: (payload: object) => void,
 *     onReject: (id: number) => void,
 *     onApprove: (id: number) => void,
 *   },
 * }} ctx
 * @returns {import('../components/UserAccountActionsMenu.jsx').UserAccountActionItem[]}
 */
export function buildUserAccountActionItems({
  accountStatus,
  u,
  isOwner,
  isLastAdmin,
  currentUserOwner,
  inviteBusy,
  handlers,
}) {
  /** @type {import('../components/UserAccountActionsMenu.jsx').UserAccountActionItem[]} */
  const items = [];

  if (currentUserOwner && !isOwner && accountStatus === 'approved') {
    items.push({
      label: 'Transfer ownership',
      onSelect: () => handlers.onTransferOwner(u),
    });
  }

  let demoteTitle;
  if (isOwner) demoteTitle = 'Cannot demote the owner';
  else if (isLastAdmin) demoteTitle = 'Cannot demote the last admin';

  items.push({
    label: u.admin ? 'Remove admin' : 'Make admin',
    disabled: isLastAdmin || isOwner,
    title: demoteTitle,
    onSelect: () => handlers.onSetAdmin(u.id, !u.admin),
  });

  if (accountStatus === 'invited') {
    items.push({
      label: 'New invite link',
      disabled: inviteBusy,
      onSelect: () => handlers.onInvite({ id: u.id }),
    });
  }

  if (accountStatus === 'approved') {
    let revokeTitle;
    if (isOwner) revokeTitle = 'Cannot revoke the owner';
    else if (isLastAdmin) revokeTitle = 'Cannot revoke the last admin';
    items.push({
      label: 'Revoke',
      danger: true,
      disabled: isLastAdmin || isOwner,
      title: revokeTitle,
      onSelect: () => handlers.onReject(u.id),
    });
  }

  if (accountStatus === 'revoked') {
    items.push({
      label: 'Approve',
      onSelect: () => handlers.onApprove(u.id),
    });
  }

  return items;
}

/**
 * @param {UserAccountUiStatus} accountStatus
 */
export function AccountStatusLabel({ accountStatus }) {
  if (accountStatus === 'invited') {
    return (
      <>
        <span className="text-xs text-accent hidden sm:inline">Invited</span>
        <span className="w-2 h-2 rounded-full bg-brand sm:hidden" aria-hidden />
      </>
    );
  }
  if (accountStatus === 'pending') {
    return (
      <>
        <span className="text-xs text-accent hidden sm:inline">Pending</span>
        <span className="w-2 h-2 rounded-full bg-brand sm:hidden" aria-hidden />
      </>
    );
  }
  if (accountStatus === 'approved') {
    return (
      <>
        <span className="text-xs text-success hidden sm:inline">Approved</span>
        <span className="w-2 h-2 rounded-full bg-ok sm:hidden" aria-hidden />
      </>
    );
  }
  if (accountStatus === 'revoked') {
    return (
      <>
        <span className="text-xs text-danger hidden sm:inline">Rejected</span>
        <span className="w-2 h-2 rounded-full bg-danger sm:hidden" aria-hidden />
      </>
    );
  }
  return null;
}
