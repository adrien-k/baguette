export const DEFAULT_GITHUB = { install_url: null, configured: false };
export const DEFAULT_BOOTSTRAP = { available: false, password_required: false };
export const DEFAULT_PASSKEYS = { available: false };

/** Map `/auth/me` JSON onto the client auth state (anonymous or signed-in). */
export function parseAuthMe(data = {}) {
  return {
    user: data.user ?? null,
    github: {
      install_url: data.github?.install_url ?? null,
      configured: Boolean(data.github?.configured),
    },
    bootstrap: {
      available: Boolean(data.bootstrap?.available),
      password_required: Boolean(data.bootstrap?.password_required),
    },
    passkeys: {
      available: Boolean(data.passkeys?.available),
    },
  };
}

/** Login page shows “Sign in with passkey” only when some user already has one. */
export function showPasskeySignIn(passkeys) {
  return Boolean(passkeys?.available);
}

/** Which login card to show from anonymous `/auth/me` (bootstrap wins). */
export function loginMode(bootstrap, github) {
  if (bootstrap?.available) return 'bootstrap';
  if (github?.configured) return 'github';
  return 'passkey';
}
