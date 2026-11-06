/**
 * Passkey registration/login with mocked @simplewebauthn/server (no real authenticators).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feathers } from 'feathers';
import { sign } from 'cookie-signature';
import { stringifySetCookie } from 'cookie';
import { createTestDb } from '../../test-utils/db.js';

vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    PUBLIC_HOST: 'http://localhost:5173',
    ENCRYPTION_KEY: 'test-encryption-key-at-least-32-chars',
  };
});

const webauthnServerMock = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...args) => webauthnServerMock.generateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args) => webauthnServerMock.verifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args) =>
    webauthnServerMock.generateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args) =>
    webauthnServerMock.verifyAuthenticationResponse(...args),
}));

import { registerUsersService } from '../../services/feathers/users.service.js';
import {
  WEBAUTHN_CHALLENGE_COOKIE,
  buildPasskeyChallengeSetCookie,
  readPasskeyChallengeCookie,
} from '../webauthn.js';
import { mountAgentConfigs } from '../../test-utils/agent-sdks.js';

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user, headers: {} });
const unauthParams = { provider: 'rest' };

function makeApp() {
  const app = feathers();
  app.set('db', db);
  mountAgentConfigs(app);
  registerUsersService(app);
  return app;
}

let app;
let user;

beforeEach(async () => {
  vi.clearAllMocks();
  await db('user_passkeys').delete();
  await db('users').delete();
  const [id] = await db('users').insert({
    github_id: null,
    username: 'bootstrap',
    status: 'approved',
    admin: 1,
  });
  user = await db('users').where({ id }).first();
  app = makeApp();
  await app.setup();

  webauthnServerMock.generateRegistrationOptions.mockResolvedValue({
    challenge: 'reg-challenge-b64',
    rp: { name: 'Baguette', id: 'localhost' },
  });
  webauthnServerMock.verifyRegistrationResponse.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      credential: {
        id: 'cred-id-b64',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal'],
      },
    },
  });
});

describe('passkey challenge cookie', () => {
  it('round-trips register challenge bound to user id', () => {
    const setCookie = buildPasskeyChallengeSetCookie({
      challenge: 'abc',
      purpose: 'register',
      userId: user.id,
    });
    expect(setCookie).toContain(`${WEBAUTHN_CHALLENGE_COOKIE}=`);
    const cookiePair = setCookie.split(';')[0];
    const value = cookiePair.split('=').slice(1).join('=');
    const header = `${WEBAUTHN_CHALLENGE_COOKIE}=${value}`;
    const parsed = readPasskeyChallengeCookie(header);
    expect(parsed).toMatchObject({ c: 'abc', p: 'register', u: user.id });
  });
});

describe('users passkeyRegisterOptions / passkeyRegisterVerify', () => {
  it('inserts a passkey after verify', async () => {
    const challengeHeader = stringifySetCookie({
      name: WEBAUTHN_CHALLENGE_COOKIE,
      value: `s:${sign(
        JSON.stringify({
          c: 'reg-challenge-b64',
          p: 'register',
          u: user.id,
          exp: Date.now() + 60_000,
        }),
        'test-encryption-key-at-least-32-chars'
      )}`,
      path: '/',
    });

    const options = await app.service('users').passkeyRegisterOptions({}, params(user));
    expect(options.challenge).toBe('reg-challenge-b64');
    expect(webauthnServerMock.generateRegistrationOptions).toHaveBeenCalled();

    const verifyParams = {
      ...params(user),
      headers: { cookie: challengeHeader },
    };
    const result = await app
      .service('users')
      .passkeyRegisterVerify({ id: 'cred-id-b64', response: {} }, verifyParams);

    expect(result).toEqual({ ok: true, passkey_count: 1 });
    const row = await db('user_passkeys').where({ user_id: user.id }).first();
    expect(row.credential_id).toBe('cred-id-b64');
    expect(row.public_key).toBeTruthy();
  });

  it('rejects unauthenticated registration', async () => {
    await expect(app.service('users').passkeyRegisterOptions({}, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });

  it('lists and removes passkeys by row id', async () => {
    await db('user_passkeys').insert({
      user_id: user.id,
      credential_id: 'listed-cred',
      public_key: 'AQID',
      counter: 0,
      device_type: 'singleDevice',
    });

    const listed = await app.service('users').passkeyList({}, params(user));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      device_type: 'singleDevice',
      backed_up: false,
    });
    expect(listed[0].id).toBeTruthy();

    const removed = await app.service('users').passkeyRemove({ id: listed[0].id }, params(user));
    expect(removed).toEqual({ ok: true });
    expect(await db('user_passkeys').where({ user_id: user.id })).toHaveLength(0);
  });

  it('patches username when provided on verify', async () => {
    const challengeHeader = stringifySetCookie({
      name: WEBAUTHN_CHALLENGE_COOKIE,
      value: `s:${sign(
        JSON.stringify({
          c: 'reg-challenge-b64',
          p: 'register',
          u: user.id,
          exp: Date.now() + 60_000,
        }),
        'test-encryption-key-at-least-32-chars'
      )}`,
      path: '/',
    });

    await app
      .service('users')
      .passkeyRegisterVerify(
        { id: 'cred-id-b64', response: {}, username: '  myname  ' },
        { ...params(user), headers: { cookie: challengeHeader } }
      );

    const updated = await db('users').where({ id: user.id }).first();
    expect(updated.username).toBe('myname');
  });
});

describe('buildNewUserPasskeyRegistrationOptions', () => {
  it('requests a discoverable credential without inserting a user', async () => {
    const { buildNewUserPasskeyRegistrationOptions } = await import('../webauthn.js');
    const before = Number((await db('users').count('* as count').first()).count);
    const options = await buildNewUserPasskeyRegistrationOptions('later');
    expect(options.challenge).toBe('reg-challenge-b64');
    expect(webauthnServerMock.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: 'later',
        authenticatorSelection: expect.objectContaining({ residentKey: 'required' }),
      })
    );
    expect(Number((await db('users').count('* as count').first()).count)).toBe(before);
  });
});

describe('verifyPasskeyAuthentication (login)', () => {
  it('returns the user and updates counter', async () => {
    const { verifyPasskeyAuthentication, buildPasskeyChallengeSetCookie } =
      await import('../webauthn.js');

    await db('user_passkeys').insert({
      user_id: user.id,
      credential_id: 'login-cred',
      public_key: 'AQID',
      counter: 0,
    });

    const challengeCookie = buildPasskeyChallengeSetCookie({
      challenge: 'login-challenge',
      purpose: 'login',
    });
    const cookieHeader = challengeCookie.split(';')[0];

    webauthnServerMock.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const loggedIn = await verifyPasskeyAuthentication(
      db,
      { id: 'login-cred', response: {} },
      cookieHeader
    );
    expect(loggedIn.id).toBe(user.id);

    const row = await db('user_passkeys').where({ credential_id: 'login-cred' }).first();
    expect(row.counter).toBe(1);
  });
});
