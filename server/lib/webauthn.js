/**
 * WebAuthn helpers for passkey registration and login.
 *
 * Registration/login option payloads returned to the client stay in SimpleWebAuthn camelCase
 * (e.g. `rpId`, `pubKeyCredParams`) so @simplewebauthn/browser can consume them unchanged.
 * Baguette Feathers/Express JSON envelopes use snake_case for our own fields only.
 */
import { parseCookie, stringifySetCookie } from 'cookie';
import { sign, unsign } from 'cookie-signature';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { PUBLIC_HOST, ENCRYPTION_KEY } from '../config.js';
import { BadRequest, NotAuthenticated } from 'feathers/errors';

export const WEBAUTHN_CHALLENGE_COOKIE = 'webauthn_challenge';
const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;
const RP_NAME = 'Baguette';

export function getWebAuthnConfig() {
  const origin = PUBLIC_HOST.replace(/\/$/, '');
  const { hostname: rpId } = new URL(origin);
  return { rpId, rpName: RP_NAME, origin };
}

function signedChallengePayload({ challenge, purpose, userId, username }) {
  return sign(
    JSON.stringify({
      c: challenge,
      p: purpose,
      u: userId ?? null,
      n: username ?? null,
      exp: Date.now() + CHALLENGE_MAX_AGE_MS,
    }),
    ENCRYPTION_KEY
  );
}

/** Set-Cookie value for a pending WebAuthn ceremony (challenge stored server-side in the cookie). */
export function buildPasskeyChallengeSetCookie({ challenge, purpose, userId, username }) {
  const value = `s:${signedChallengePayload({ challenge, purpose, userId, username })}`;
  return stringifySetCookie({
    name: WEBAUTHN_CHALLENGE_COOKIE,
    value,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: Math.floor(CHALLENGE_MAX_AGE_MS / 1000),
    path: '/',
  });
}

export function buildPasskeyChallengeClearCookie() {
  return stringifySetCookie({
    name: WEBAUTHN_CHALLENGE_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}

export function readPasskeyChallengeCookie(cookieHeader) {
  const cookies = parseCookie(cookieHeader || '');
  const raw = cookies[WEBAUTHN_CHALLENGE_COOKIE];
  if (!raw || !raw.startsWith('s:')) return null;
  const unsigned = unsign(raw.slice(2), ENCRYPTION_KEY);
  if (unsigned === false) return null;
  try {
    const parsed = JSON.parse(unsigned);
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    if (typeof parsed.c !== 'string' || typeof parsed.p !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function challengeCookieHeaderFromParams(params) {
  const headers = params?.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get('cookie') || '';
  }
  return headers.cookie || headers.Cookie || '';
}

const authenticatorSelection = {
  residentKey: 'preferred',
  userVerification: 'preferred',
};

const discoverableAuthenticatorSelection = {
  residentKey: 'required',
  userVerification: 'preferred',
};

export async function buildPasskeyRegistrationOptions(db, user, data) {
  const { rpId, rpName, origin: _origin } = getWebAuthnConfig();
  const passkeys = await db('user_passkeys').where({ user_id: user.id });
  const excludeCredentials = passkeys.map((row) => ({
    id: row.credential_id,
    transports: row.transports ? JSON.parse(row.transports) : undefined,
  }));

  const displayName =
    typeof data?.username === 'string' && data.username.trim()
      ? data.username.trim()
      : user.username;

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: displayName,
    userID: isoUint8Array.fromUTF8String(String(user.id)),
    userDisplayName: displayName,
    excludeCredentials,
    authenticatorSelection,
  });

  return options;
}

/** Registration options for a not-yet-created user (discoverable / resident key). */
export async function buildNewUserPasskeyRegistrationOptions(username) {
  const { rpId, rpName } = getWebAuthnConfig();
  return generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: username,
    userID: isoUint8Array.fromUTF8String(crypto.randomUUID()),
    userDisplayName: username,
    authenticatorSelection: discoverableAuthenticatorSelection,
  });
}

async function verifyRegistrationResponseAgainstChallenge(response, expectedChallenge) {
  const { rpId, origin } = getWebAuthnConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new BadRequest('Passkey registration verification failed');
  }

  return verification.registrationInfo;
}

export async function insertUserPasskey(db, userId, registrationInfo) {
  const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;
  const transports = credential.transports?.length ? JSON.stringify(credential.transports) : null;

  await db('user_passkeys').insert({
    user_id: userId,
    credential_id: credential.id,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports,
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp ? 1 : 0,
  });

  return { credentialId: credential.id };
}

export async function verifyPasskeyRegistration(db, user, response, cookieHeader) {
  const stored = readPasskeyChallengeCookie(cookieHeader);
  if (!stored || stored.p !== 'register' || String(stored.u) !== String(user.id)) {
    throw new BadRequest('Invalid or expired passkey challenge');
  }

  const registrationInfo = await verifyRegistrationResponseAgainstChallenge(response, stored.c);
  return insertUserPasskey(db, user.id, registrationInfo);
}

/**
 * Verify an invite passkey ceremony (`purpose=invite`) without inserting.
 * Caller inserts the passkey, then clears the invite token.
 */
export async function verifyInvitePasskeyRegistration(
  response,
  cookieHeader,
  { userId, username }
) {
  const stored = readPasskeyChallengeCookie(cookieHeader);
  if (!stored || stored.p !== 'invite' || String(stored.u) !== String(userId)) {
    throw new BadRequest('Invalid or expired passkey challenge');
  }
  if (stored.n != null && stored.n !== username) {
    throw new BadRequest('Invalid or expired passkey challenge');
  }
  return verifyRegistrationResponseAgainstChallenge(response, stored.c);
}

export async function buildPasskeyAuthenticationOptions() {
  const { rpId } = getWebAuthnConfig();
  return generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials: [],
    userVerification: 'preferred',
  });
}

export async function verifyPasskeyAuthentication(db, response, cookieHeader) {
  const stored = readPasskeyChallengeCookie(cookieHeader);
  if (!stored || stored.p !== 'login') {
    throw new BadRequest('Invalid or expired passkey challenge');
  }

  const passkey = await db('user_passkeys').where({ credential_id: response.id }).first();
  if (!passkey) {
    throw new NotAuthenticated('Unknown passkey');
  }

  const { rpId, origin } = getWebAuthnConfig();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: stored.c,
    expectedOrigin: origin,
    expectedRPID: rpId,
    credential: {
      id: passkey.credential_id,
      publicKey: isoBase64URL.toBuffer(passkey.public_key),
      counter: passkey.counter,
      transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
    },
  });

  if (!verification.verified) {
    throw new NotAuthenticated('Passkey verification failed');
  }

  const newCounter = verification.authenticationInfo.newCounter;
  await db('user_passkeys').where({ id: passkey.id }).update({ counter: newCounter });

  const user = await db('users').where({ id: passkey.user_id }).first();
  if (!user) {
    throw new NotAuthenticated('Unknown passkey');
  }

  return user;
}

export async function countPasskeysForUser(db, userId) {
  const row = await db('user_passkeys').where({ user_id: userId }).count('* as count').first();
  return Number(row?.count ?? 0);
}

/** True when at least one user has registered a passkey (login page gating). */
export async function instanceHasPasskeys(db) {
  const row = await db('user_passkeys').count('* as count').first();
  return Number(row?.count ?? 0) > 0;
}
