import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOTSTRAP,
  DEFAULT_GITHUB,
  DEFAULT_PASSKEYS,
  loginMode,
  parseAuthMe,
  showPasskeySignIn,
} from '../authMe.js';

describe('parseAuthMe', () => {
  it('defaults github.configured and bootstrap when /auth/me omits them', () => {
    expect(parseAuthMe({ user: null })).toEqual({
      user: null,
      github: DEFAULT_GITHUB,
      bootstrap: DEFAULT_BOOTSTRAP,
      passkeys: DEFAULT_PASSKEYS,
    });
  });

  it('stores github.configured, bootstrap, and user.admin from /auth/me', () => {
    const parsed = parseAuthMe({
      user: {
        id: 1,
        username: 'bootstrap',
        approved: true,
        admin: true,
        onboarding_completed: false,
        github_linked: false,
        passkey_count: 0,
      },
      github: {
        install_url: 'https://github.com/apps/baguette/installations/new',
        configured: true,
      },
      bootstrap: { available: false, password_required: true },
      passkeys: { available: true },
    });

    expect(parsed.github.configured).toBe(true);
    expect(parsed.github.install_url).toContain('/installations/new');
    expect(parsed.bootstrap).toEqual({ available: false, password_required: true });
    expect(parsed.passkeys).toEqual({ available: true });
    expect(parsed.user.admin).toBe(true);
  });

  it('coerces missing configured/available flags to false', () => {
    const parsed = parseAuthMe({
      user: null,
      github: { install_url: null },
      bootstrap: {},
    });
    expect(parsed.github.configured).toBe(false);
    expect(parsed.bootstrap.available).toBe(false);
    expect(parsed.bootstrap.password_required).toBe(false);
    expect(parsed.passkeys.available).toBe(false);
  });
});

describe('loginMode', () => {
  it('prefers bootstrap when the instance has no users', () => {
    expect(loginMode({ available: true, password_required: false }, { configured: true })).toBe(
      'bootstrap'
    );
  });

  it('shows GitHub when the app is configured and bootstrap is taken', () => {
    expect(loginMode({ available: false, password_required: false }, { configured: true })).toBe(
      'github'
    );
  });

  it('hides GitHub when the app is not configured', () => {
    expect(loginMode({ available: false, password_required: false }, { configured: false })).toBe(
      'passkey'
    );
    expect(loginMode(undefined, undefined)).toBe('passkey');
  });
});

describe('showPasskeySignIn', () => {
  it('is true only when at least one user has a passkey', () => {
    expect(showPasskeySignIn(undefined)).toBe(false);
    expect(showPasskeySignIn({ available: false })).toBe(false);
    expect(showPasskeySignIn({ available: true })).toBe(true);
  });
});
