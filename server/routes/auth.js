import crypto from 'crypto';
import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { getClientIp } from '../lib/client-ip.js';
import { touchUserLastIp } from '../lib/user-last-ip.js';
import { signProxyToken, buildSessionHostname } from '../services/preview.js';
import { cacheScopeForUser, clearReposCache, clearInstallationsCache } from '../services/github.js';
import { PUBLIC_HOST, PUBLIC_API_URL } from '../config.js';
import { getGithubAppConfig } from '../lib/instance-settings.js';
import {
  buildGithubManifestPayload,
  convertGithubAppManifest,
  persistGithubAppConversion,
  conversionIncludesManifestState,
  createManifestState,
  defaultGithubManifestReturnPath,
  MANIFEST_RETURN_COOKIE,
  MANIFEST_RETURN_COOKIE_MAX_AGE_MS,
  MANIFEST_STATE_COOKIE,
  MANIFEST_STATE_COOKIE_MAX_AGE_MS,
} from '../lib/github-app-manifest.js';
import { toSafePath } from '../lib/safe-path.js';
import {
  buildPasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
  buildPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  buildNewUserPasskeyRegistrationOptions,
  verifyInvitePasskeyRegistration,
  insertUserPasskey,
  buildPasskeyChallengeSetCookie,
  buildPasskeyChallengeClearCookie,
  countPasskeysForUser,
  instanceHasPasskeys,
} from '../lib/webauthn.js';
import { ensureMockAgentConfig } from '../agent-sdks/mock/mock-agent-config.js';
import { isMockAgentSdkEnabled, MOCK_STANDARD_MODEL_ID } from '../../shared/mock-agent-sdk.js';
import { createIpRateLimiter } from '../lib/ip-rate-limit.js';
import { hashInviteToken, isInviteExpired } from '../lib/user-invite.js';

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

const BOOTSTRAP_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BOOTSTRAP_RATE_WINDOW_MS = 15 * 60 * 1000;
const BOOTSTRAP_RATE_MAX_ATTEMPTS = 30;
const bootstrapLimiter = createIpRateLimiter({
  windowMs: BOOTSTRAP_RATE_WINDOW_MS,
  maxAttempts: BOOTSTRAP_RATE_MAX_ATTEMPTS,
});
const PASSKEY_RATE_WINDOW_MS = 15 * 60 * 1000;
const PASSKEY_RATE_MAX_ATTEMPTS = 30;
const passkeyLimiter = createIpRateLimiter({
  windowMs: PASSKEY_RATE_WINDOW_MS,
  maxAttempts: PASSKEY_RATE_MAX_ATTEMPTS,
});

function isBootstrapPasswordGateEnabled() {
  const configured = process.env.BOOTSTRAP_PASSWORD;
  return configured != null && configured !== '';
}

function bootstrapPasswordRequired() {
  return isBootstrapPasswordGateEnabled();
}

/** Fixed-length digest compare so timingSafeEqual never sees unequal buffer lengths. */
function verifyBootstrapPassword(provided) {
  if (!isBootstrapPasswordGateEnabled()) return true;
  const expected = process.env.BOOTSTRAP_PASSWORD;
  const providedDigest = crypto
    .createHash('sha256')
    .update(String(provided ?? ''), 'utf8')
    .digest();
  const expectedDigest = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function checkBootstrapRateLimit(ip) {
  if (!isBootstrapPasswordGateEnabled()) return false;
  return bootstrapLimiter.isLimited(ip);
}

function recordBootstrapFailure(ip) {
  if (!isBootstrapPasswordGateEnabled()) return;
  bootstrapLimiter.record(ip);
}

function checkPasskeyRateLimit(ip) {
  return passkeyLimiter.isLimited(ip);
}

function recordPasskeyAttempt(ip) {
  passkeyLimiter.record(ip);
}

async function loadInviteUser(token) {
  if (!token || typeof token !== 'string') return { error: 'invalid' };
  const user = await db('users')
    .where({ invite_token_hash: hashInviteToken(token) })
    .first();
  if (!user) return { error: 'invalid' };
  if (isInviteExpired(user)) return { error: 'expired', user };
  return { user };
}

function inviteBlocked(req, res) {
  if (req.user || req.pendingUser) {
    res.status(400).json({ error: 'Already signed in' });
    return true;
  }
  return false;
}

function setBootstrapUserCookie(res, userId) {
  res.cookie('userId', String(userId), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: BOOTSTRAP_COOKIE_MAX_AGE_MS,
  });
}

async function bootstrapAvailability() {
  const countRow = await db('users').count('* as count').first();
  const count = Number(countRow?.count ?? 0);
  return {
    available: count === 0,
    password_required: bootstrapPasswordRequired(),
  };
}

async function userIsFirst(userId) {
  const first = await db('users').orderBy('id', 'asc').select('id').first();
  return Number(first?.id) === Number(userId);
}

export function createAuthRoutes(app) {
  const router = Router();

  if (process.env.NODE_ENV === 'development') {
    router.get('/auth/dev', async (req, res, next) => {
      try {
        const devGhKey = process.env.DEV_USER_GH_KEY || '';
        let user = await db('users').where({ email: 'dev@baguette.local' }).first();
        if (!user) {
          const created = await app.service('users').create(
            {
              github_id: 0,
              username: 'dev',
              email: 'dev@baguette.local',
              access_token: devGhKey,
              approved: true,
              admin: true,
              onboarding_completed: true,
            },
            {} // internal call — no provider, no user required
          );
          user = { id: created.id };
        } else {
          const patch = {};
          if (devGhKey) patch.access_token = devGhKey;
          if (!user.onboarding_completed) patch.onboarding_completed = true;
          if (Object.keys(patch).length) {
            await app.service('users').patch(user.id, patch, {});
          }
        }

        const mockConfigId = await ensureMockAgentConfig(db, user.id);
        if (mockConfigId && isMockAgentSdkEnabled()) {
          const mockDefaultModel = {
            model: MOCK_STANDARD_MODEL_ID,
            model_params: null,
          };
          const devUser = await db('users').where({ id: user.id }).first();
          await app.service('users').patch(
            user.id,
            {
              agent_default_config_id: mockConfigId,
              agent_default_model: mockDefaultModel,
              reviewer_default_config_id: mockConfigId,
              reviewer_default_model: mockDefaultModel,
            },
            { user: devUser }
          );
        }

        setBootstrapUserCookie(res, user.id);
        await touchUserLastIp(db, user.id, getClientIp(req), req, { force: true });

        res.redirect(toSafePath(req.query.redirectTo) ?? '/');
      } catch (err) {
        logger.error(err, 'Dev sign-in error');
        next(err);
      }
    });
  }

  /** Stores a post-auth redirect target, ignoring anything that isn't a local path. */
  const setRedirectCookie = (req, res) => {
    const dest = toSafePath(req.query.redirectTo);
    if (dest) {
      res.cookie('auth_redirect', dest, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
      });
    }
  };

  router.get('/auth/github', async (req, res) => {
    const github = await getGithubAppConfig(db);
    if (!github.configured) return res.status(503).send('GitHub App not configured');

    setRedirectCookie(req, res);

    // No `scope` — GitHub Apps ignore it. Access comes from the App's registered permissions
    // and from the repos the user picked when installing it.
    const params = new URLSearchParams({
      client_id: github.client_id,
      redirect_uri: new URL('/auth/github/callback', PUBLIC_HOST).toString(),
    });
    res.redirect(`${GITHUB_AUTH_URL}?${params}`);
  });

  // Sends the user to GitHub to install the App (and choose which repos it can access).
  // GitHub redirects back to /auth/github/callback when done.
  router.get('/auth/github/install', async (req, res) => {
    const github = await getGithubAppConfig(db);
    if (!github.install_url) return res.status(503).send('GitHub App not configured');
    setRedirectCookie(req, res);
    res.redirect(github.install_url);
  });

  /** Consumes the auth_redirect cookie and sends the user on to it (or the app root). */
  const finishRedirect = (req, res) => {
    const redirectTo = req.cookies?.auth_redirect;
    res.clearCookie('auth_redirect');
    res.redirect(toSafePath(redirectTo) ?? '/');
  };

  /** Drops cached repo/installation lists so newly granted repos appear immediately. */
  const invalidateRepoCaches = async (userId) => {
    const scope = cacheScopeForUser({ id: userId });
    await Promise.all([clearReposCache(scope), clearInstallationsCache(scope)]);
  };

  router.get('/auth/github/callback', async (req, res, next) => {
    const github = await getGithubAppConfig(db);
    if (!github.configured) return res.status(503).send('GitHub App not configured');
    const { code, setup_action: setupAction, installation_id: installationId } = req.query;

    // Returning from an App install with no code to exchange — the App does not request user
    // authorization during installation. A signed-in user may still hold a token that predates the
    // App (e.g. from a pre-App install of Baguette), which GitHub rejects on App-only endpoints
    // such as /user/installations, leaving the repo picker permanently empty. Re-run the authorize
    // flow to mint a fresh user-to-server token; GitHub sends an already-authorized user straight
    // back, this time with a code. auth_redirect is left intact so they still land where they
    // started.
    if (!code && (setupAction || installationId)) {
      const userId = req.signedCookies?.userId;
      if (userId) {
        await invalidateRepoCaches(userId);
        return res.redirect('/auth/github');
      }
      return finishRedirect(req, res);
    }
    if (!code) return res.status(400).send('Missing code');

    try {
      const tokenRes = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: github.client_id,
          client_secret: github.client_secret,
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) {
        return res.status(400).json({ error: tokenData.error_description });
      }

      const accessToken = tokenData.access_token;

      const userRes = await fetch(GITHUB_USER_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const ghUser = await userRes.json();

      const cookiedUserId = req.signedCookies?.userId;
      const currentUser = cookiedUserId
        ? await db('users')
            .where({ id: Number(cookiedUserId) })
            .first()
        : null;

      const existingByGithub = await db('users').where({ github_id: ghUser.id }).first();
      let userId;

      if (currentUser) {
        if (currentUser.github_id != null && Number(currentUser.github_id) !== Number(ghUser.id)) {
          return res.status(409).json({ error: 'GitHub account conflict' });
        }
        if (existingByGithub && existingByGithub.id !== currentUser.id) {
          return res.status(409).json({ error: 'GitHub account already linked to another user' });
        }

        await app.service('users').patch(
          currentUser.id,
          {
            github_id: ghUser.id,
            username: ghUser.login,
            avatar_url: ghUser.avatar_url,
            access_token: accessToken,
            ...(ghUser.email ? { email: ghUser.email } : {}),
          },
          {}
        );
        userId = currentUser.id;
      } else if (existingByGithub) {
        await app.service('users').patch(
          existingByGithub.id,
          {
            username: ghUser.login,
            avatar_url: ghUser.avatar_url,
            access_token: accessToken,
            ...(ghUser.email ? { email: ghUser.email } : {}),
          },
          {}
        );
        userId = existingByGithub.id;
      } else {
        const userCount = await db('users').count('* as count').first();
        const isFirstUser = userCount.count === 0;

        const created = await app.service('users').create(
          {
            github_id: ghUser.id,
            username: ghUser.login,
            avatar_url: ghUser.avatar_url,
            email: ghUser.email || null,
            access_token: accessToken,
            approved: isFirstUser,
            admin: isFirstUser,
          },
          {}
        );
        userId = created.id;
      }

      setBootstrapUserCookie(res, userId);
      await touchUserLastIp(db, userId, getClientIp(req), req, { force: true });

      // Authorizing as part of an App install: the repo list just changed.
      if (setupAction || installationId) await invalidateRepoCaches(userId);

      finishRedirect(req, res);
    } catch (err) {
      logger.error(err, 'GitHub auth error');
      next(err);
    }
  });

  router.post('/auth/bootstrap', async (req, res, next) => {
    try {
      const clientIp = getClientIp(req);
      if (checkBootstrapRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Too many bootstrap attempts' });
      }

      if (!verifyBootstrapPassword(req.body?.password)) {
        recordBootstrapFailure(clientIp);
        return res.status(403).json({ error: 'Forbidden' });
      }

      let created;
      try {
        await db.transaction(async (trx) => {
          const countRow = await trx('users').count('* as count').first();
          if (Number(countRow?.count ?? 0) > 0) {
            const err = new Error('Bootstrap already taken');
            err.statusCode = 409;
            throw err;
          }

          created = await app.service('users').create(
            {
              github_id: null,
              username: 'bootstrap',
              approved: true,
              admin: true,
              onboarding_completed: false,
            },
            { transaction: { trx } }
          );
        });
      } catch (err) {
        if (err.statusCode === 409) {
          return res.status(409).json({ error: 'Bootstrap already taken' });
        }
        throw err;
      }

      setBootstrapUserCookie(res, created.id);
      await touchUserLastIp(db, created.id, clientIp, req, { force: true });
      res.json({
        user: {
          id: created.id,
          username: created.username,
          approved: true,
          admin: true,
          onboarding_completed: false,
          is_first_user: true,
        },
      });
    } catch (err) {
      logger.error(err, 'Bootstrap claim error');
      next(err);
    }
  });

  router.get('/auth/me', async (req, res) => {
    // Sent regardless of sign-in state so the login and pending screens can explain what
    // they are connecting to. Identity comes from the shared cookie middleware: req.user
    // is an approved user, req.pendingUser a signed-in but unapproved one (reported with
    // approved:false so the client can show the approval screen — it holds no other
    // privileges server-side).
    const ghConfig = await getGithubAppConfig(db);
    const github = {
      install_url: ghConfig.install_url,
      configured: ghConfig.configured,
    };
    const bootstrap = await bootstrapAvailability();
    const passkeys = { available: await instanceHasPasskeys(db) };
    const identity = req.user ?? req.pendingUser;
    if (!identity) return res.json({ user: null, github, bootstrap, passkeys });

    const passkey_count = await countPasskeysForUser(db, identity.id);
    const is_first_user = await userIsFirst(identity.id);

    res.json({
      github,
      bootstrap,
      passkeys,
      user: {
        id: identity.id,
        username: identity.username,
        avatar_url: identity.avatar_url,
        approved: !!identity.approved,
        admin: !!identity.admin,
        onboarding_completed: !!identity.onboarding_completed,
        color_scheme: identity.color_scheme === 'light' ? 'light' : 'dark',
        github_linked: identity.github_id != null,
        passkey_count,
        is_first_user,
      },
    });
  });

  router.post('/auth/passkey/options', async (req, res, next) => {
    try {
      const clientIp = getClientIp(req);
      if (checkPasskeyRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Too many passkey attempts' });
      }
      recordPasskeyAttempt(clientIp);

      const options = await buildPasskeyAuthenticationOptions();
      res.setHeader(
        'Set-Cookie',
        buildPasskeyChallengeSetCookie({
          challenge: options.challenge,
          purpose: 'login',
        })
      );
      res.json(options);
    } catch (err) {
      logger.error(err, 'Passkey options error');
      next(err);
    }
  });

  router.post('/auth/passkey/verify', async (req, res, next) => {
    try {
      const cookieHeader = req.headers.cookie || '';
      const user = await verifyPasskeyAuthentication(db, req.body, cookieHeader);
      setBootstrapUserCookie(res, user.id);
      res.append('Set-Cookie', buildPasskeyChallengeClearCookie());
      await touchUserLastIp(db, user.id, getClientIp(req), req, { force: true });
      res.json({
        user: {
          id: user.id,
          username: user.username,
          approved: !!user.approved,
          admin: !!user.admin,
          onboarding_completed: !!user.onboarding_completed,
          is_first_user: await userIsFirst(user.id),
        },
      });
    } catch (err) {
      if (err.name === 'NotAuthenticated' || err.name === 'BadRequest') {
        return res.status(err.name === 'NotAuthenticated' ? 401 : 400).json({
          error: err.message,
        });
      }
      logger.error(err, 'Passkey verify error');
      next(err);
    }
  });

  // Registration challenge must be a browser cookie (`webauthn_challenge`). Express sets
  // Set-Cookie directly; the Feathers REST client may not surface context.http.headers.
  router.post('/auth/passkey/register/options', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const options = await buildPasskeyRegistrationOptions(db, req.user, req.body);
      res.setHeader(
        'Set-Cookie',
        buildPasskeyChallengeSetCookie({
          challenge: options.challenge,
          purpose: 'register',
          userId: req.user.id,
        })
      );
      res.json(options);
    } catch (err) {
      logger.error(err, 'Passkey register options error');
      next(err);
    }
  });

  router.post('/auth/passkey/register/verify', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const cookieHeader = req.headers.cookie || '';
      await verifyPasskeyRegistration(db, req.user, req.body, cookieHeader);

      if (typeof req.body?.username === 'string') {
        const username = req.body.username.trim();
        if (username) {
          await db('users').where({ id: req.user.id }).update({ username });
        }
      }

      res.append('Set-Cookie', buildPasskeyChallengeClearCookie());
      const passkey_count = await countPasskeysForUser(db, req.user.id);
      res.json({ ok: true, passkey_count });
    } catch (err) {
      if (err.name === 'NotAuthenticated' || err.name === 'BadRequest') {
        return res.status(err.name === 'NotAuthenticated' ? 401 : 400).json({
          error: err.message,
        });
      }
      logger.error(err, 'Passkey register verify error');
      next(err);
    }
  });

  router.get('/auth/invite/:token', async (req, res, next) => {
    try {
      if (inviteBlocked(req, res)) return;
      const loaded = await loadInviteUser(req.params.token);
      if (loaded.error === 'expired') {
        return res
          .status(410)
          .json({ error: 'This invite link has expired. Ask an admin for a new one.' });
      }
      if (loaded.error || !loaded.user) {
        return res.status(404).json({
          error: 'This invite link is invalid or has already been used.',
        });
      }
      res.json({ username: loaded.user.username });
    } catch (err) {
      logger.error(err, 'Invite lookup error');
      next(err);
    }
  });

  router.post('/auth/invite/:token/options', async (req, res, next) => {
    try {
      if (inviteBlocked(req, res)) return;

      const loaded = await loadInviteUser(req.params.token);
      if (loaded.error === 'expired') {
        return res
          .status(410)
          .json({ error: 'This invite link has expired. Ask an admin for a new one.' });
      }
      if (loaded.error || !loaded.user) {
        return res.status(404).json({
          error: 'This invite link is invalid or has already been used.',
        });
      }

      const clientIp = getClientIp(req);
      if (checkPasskeyRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Too many passkey attempts' });
      }
      recordPasskeyAttempt(clientIp);

      const options = await buildNewUserPasskeyRegistrationOptions(loaded.user.username);
      res.setHeader(
        'Set-Cookie',
        buildPasskeyChallengeSetCookie({
          challenge: options.challenge,
          purpose: 'invite',
          userId: loaded.user.id,
          username: loaded.user.username,
        })
      );
      res.json(options);
    } catch (err) {
      logger.error(err, 'Invite options error');
      next(err);
    }
  });

  router.post('/auth/invite/:token/verify', async (req, res, next) => {
    try {
      if (inviteBlocked(req, res)) return;

      const token = req.params.token;
      const loaded = await loadInviteUser(token);
      if (loaded.error === 'expired') {
        return res
          .status(410)
          .json({ error: 'This invite link has expired. Ask an admin for a new one.' });
      }
      if (loaded.error || !loaded.user) {
        return res.status(404).json({
          error: 'This invite link is invalid or has already been used.',
        });
      }

      const cookieHeader = req.headers.cookie || '';
      const registrationInfo = await verifyInvitePasskeyRegistration(req.body, cookieHeader, {
        userId: loaded.user.id,
        username: loaded.user.username,
      });

      await db.transaction(async (trx) => {
        const stillOpen = await trx('users')
          .where({ id: loaded.user.id, invite_token_hash: hashInviteToken(token) })
          .first();
        if (!stillOpen) {
          const err = new Error('This invite link is invalid or has already been used.');
          err.name = 'BadRequest';
          throw err;
        }
        await insertUserPasskey(trx, loaded.user.id, registrationInfo);
        await trx('users').where({ id: loaded.user.id }).update({
          invite_token_hash: null,
          invite_expires_at: null,
        });
      });

      setBootstrapUserCookie(res, loaded.user.id);
      res.append('Set-Cookie', buildPasskeyChallengeClearCookie());
      await touchUserLastIp(db, loaded.user.id, getClientIp(req), req, { force: true });
      res.json({
        user: {
          id: loaded.user.id,
          username: loaded.user.username,
          approved: true,
          admin: !!loaded.user.admin,
          onboarding_completed: !!loaded.user.onboarding_completed,
          is_first_user: await userIsFirst(loaded.user.id),
        },
      });
    } catch (err) {
      if (err.name === 'NotAuthenticated' || err.name === 'BadRequest') {
        return res.status(err.name === 'NotAuthenticated' ? 401 : 400).json({
          error: err.message,
        });
      }
      logger.error(err, 'Invite verify error');
      next(err);
    }
  });

  // Signs a proxy token for the given service subdomain and redirects there.
  // Used by the dev-proxy middleware when the user has no baguette_proxy cookie.
  const redirectToProxyLogin = (res, service, safeRedirectTo) => {
    const returnParams = new URLSearchParams({ service });
    if (safeRedirectTo) returnParams.set('redirectTo', safeRedirectTo);
    const loginUrl = new URL('/login', PUBLIC_HOST);
    loginUrl.searchParams.set('redirectTo', `/auth/proxy?${returnParams}`);
    return res.redirect(loginUrl.toString());
  };

  router.get('/auth/proxy', async (req, res, _next) => {
    const service = req.query.service;
    if (!service) return res.status(400).json({ error: 'Missing service parameter' });

    const safeRedirectTo = toSafePath(req.query.redirectTo);

    // Identity is resolved by the shared cookie middleware (req.user = approved,
    // req.pendingUser = signed in but unapproved). Only approved users may mint
    // proxy tokens for the preview subdomains.
    if (req.pendingUser) {
      return res.status(403).render('devserver-denied', {
        title: 'Account pending approval',
        message: 'An existing user must approve this account before previews can be opened.',
        backUrl: PUBLIC_HOST,
      });
    }
    if (!req.user) {
      if (req.signedCookies?.userId) res.clearCookie('userId');
      return redirectToProxyLogin(res, service, safeRedirectTo);
    }

    const token = signProxyToken(req.user.id);
    const { protocol, hostname } = new URL(PUBLIC_API_URL);

    const redirectToParam = safeRedirectTo
      ? `&redirectTo=${encodeURIComponent(safeRedirectTo)}`
      : '';
    const authUrl = `${protocol}//${buildSessionHostname(hostname, service)}/_baguette/auth?sign=${token}${redirectToParam}`;
    return res.redirect(authUrl);
  });

  router.post('/auth/logout', (req, res) => {
    res.clearCookie('userId');
    res.json({ ok: true });
  });

  const requireSignedInAdmin = (req, res) => {
    if (!req.user) return res.status(401).send('Unauthorized');
    if (!req.user.admin) return res.status(403).send('Forbidden');
    return null;
  };

  const setManifestReturnCookie = (req, res) => {
    const dest = toSafePath(req.query.return_to);
    if (dest) {
      res.cookie(MANIFEST_RETURN_COOKIE, dest, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: MANIFEST_RETURN_COOKIE_MAX_AGE_MS,
      });
    }
  };

  const finishManifestRedirect = (req, res) => {
    const fromCookie = req.cookies?.[MANIFEST_RETURN_COOKIE];
    res.clearCookie(MANIFEST_RETURN_COOKIE);
    const dest = toSafePath(fromCookie) ?? defaultGithubManifestReturnPath(req.user);
    res.redirect(dest);
  };

  router.get('/auth/github/manifest', async (req, res) => {
    if (requireSignedInAdmin(req, res)) return;

    const state = createManifestState();
    res.cookie(MANIFEST_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: MANIFEST_STATE_COOKIE_MAX_AGE_MS,
    });
    setManifestReturnCookie(req, res);

    res.json(buildGithubManifestPayload({ org: req.query.org, state }));
  });

  router.get('/auth/github/manifest/callback', async (req, res, next) => {
    if (requireSignedInAdmin(req, res)) return;

    const { code } = req.query;
    if (!code || typeof code !== 'string') return res.status(400).send('Missing code');

    const expectedState = req.cookies?.[MANIFEST_STATE_COOKIE];
    res.clearCookie(MANIFEST_STATE_COOKIE);
    if (!expectedState || typeof expectedState !== 'string') {
      return res.status(403).send('Missing manifest state');
    }
    const queryState = req.query.state;
    if (typeof queryState === 'string' && queryState !== expectedState) {
      return res.status(403).send('Invalid manifest state');
    }

    try {
      const conversion = await convertGithubAppManifest(code);
      if (!conversionIncludesManifestState(conversion, expectedState)) {
        return res.status(403).send('Invalid manifest state');
      }
      await persistGithubAppConversion(db, conversion);
      finishManifestRedirect(req, res);
    } catch (err) {
      logger.error(err, 'GitHub App manifest conversion failed');
      if (err.status) return res.status(502).send('GitHub App manifest conversion failed');
      next(err);
    }
  });

  return router;
}
