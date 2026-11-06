import { resolveUserStatus, USER_STATUS_REVOKED } from '../../shared/user-status.js';

/**
 * Copy for signed-in accounts that are not approved: still waiting, or explicitly revoked.
 */

export function unapprovedAccountError(user) {
  if (resolveUserStatus(user) === USER_STATUS_REVOKED) return 'Account access has been revoked';
  return 'Account pending approval';
}

export function unapprovedPreviewDenial(user) {
  if (resolveUserStatus(user) === USER_STATUS_REVOKED) {
    return {
      title: 'Account access revoked',
      message: 'This account can no longer open previews.',
    };
  }
  return {
    title: 'Account pending approval',
    message: 'An existing user must approve this account before previews can be opened.',
  };
}
