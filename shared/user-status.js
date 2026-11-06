/** @typedef {'pending' | 'approved' | 'revoked'} UserStatus */

export const USER_STATUS_PENDING = 'pending';
export const USER_STATUS_APPROVED = 'approved';
export const USER_STATUS_REVOKED = 'revoked';

export const USER_STATUS_VALUES = [USER_STATUS_PENDING, USER_STATUS_APPROVED, USER_STATUS_REVOKED];

/**
 * Resolve account status from a user row or API payload.
 * Prefers `status`; falls back to legacy `approved` / `revoked` booleans.
 *
 * @param {{ status?: string, approved?: unknown, revoked?: unknown } | null | undefined} user
 * @returns {UserStatus}
 */
export function resolveUserStatus(user) {
  const status = user?.status;
  if (
    status === USER_STATUS_APPROVED ||
    status === USER_STATUS_PENDING ||
    status === USER_STATUS_REVOKED
  ) {
    return status;
  }
  if (user?.revoked) return USER_STATUS_REVOKED;
  if (user?.approved) return USER_STATUS_APPROVED;
  return USER_STATUS_PENDING;
}

/** @param {{ status?: string, approved?: unknown, revoked?: unknown } | null | undefined} user */
export function isApprovedUser(user) {
  return resolveUserStatus(user) === USER_STATUS_APPROVED;
}
