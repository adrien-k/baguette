import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { signProxyToken, buildSessionHostname } from '../services/preview.js';
import { cacheScopeForUser, clearReposCache, clearInstallationsCache } from '../services/github.js';
import {
  AUTH_GITHUB_CLIENT_ID,
  AUTH_GITHUB_CLIENT_SECRET,
  GITHUB_APP_INSTALL_URL,
  PUBLIC_HOST,
  PUBLIC_API_URL,
} from '../config.js';

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

export function createAuthRoutes(app) {
  const router = Router();

  if (process.env.NODE_ENV === 'development') {
    router.get('/auth/dev', async (req, res) => {
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
            },
            {} // internal call — no provider, no user required
          );
          user = { id: created.id };
        } else if (devGhKey) {
          await app.service('users').patch(user.id, { access_token: devGhKey }, {});
        }

        res.cookie('userId', String(user.id), {
          signed: true,
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        const redirectTo = req.query.redirectTo;
        const dest =
          redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')
            ? redirectTo
            : '/';
        res.redirect(dest);
      } catch (err) {
        logger.error(err, 'Dev sign-in error');
        res.status(500).send('Dev sign-in failed');
      }
    });
  }

  /** Stores a post-auth redirect target, ignoring anything that isn't a local path. */
  const setRedirectCookie = (req, res) => {
    const { redirectTo } = req.query;
    if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
      res.cookie('auth_redirect', redirectTo, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
      });
    }
  };

  router.get('/auth/github', (req, res) => {
    if (!AUTH_GITHUB_CLIENT_ID) return res.status(503).send('GitHub App not configured');

    setRedirectCookie(req, res);

    // No `scope` — GitHub Apps ignore it. Access comes from the App's registered permissions
    // and from the repos the user picked when installing it.
    const params = new URLSearchParams({
      client_id: AUTH_GITHUB_CLIENT_ID,
      redirect_uri: new URL('/auth/github/callback', PUBLIC_HOST).toString(),
    });
    res.redirect(`${GITHUB_AUTH_URL}?${params}`);
  });

  // Sends the user to GitHub to install the App (and choose which repos it can access).
  // GitHub redirects back to /auth/github/callback when done.
  router.get('/auth/github/install', (req, res) => {
    if (!GITHUB_APP_INSTALL_URL) return res.status(503).send('GitHub App not configured');
    setRedirectCookie(req, res);
    res.redirect(GITHUB_APP_INSTALL_URL);
  });

  /** Consumes the auth_redirect cookie and sends the user on to it (or the app root). */
  const finishRedirect = (req, res) => {
    const redirectTo = req.cookies?.auth_redirect;
    res.clearCookie('auth_redirect');
    const dest =
      redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/';
    res.redirect(dest);
  };

  /** Drops cached repo/installation lists so newly granted repos appear immediately. */
  const invalidateRepoCaches = async (userId) => {
    const scope = cacheScopeForUser({ id: userId });
    await Promise.all([clearReposCache(scope), clearInstallationsCache(scope)]);
  };

  router.get('/auth/github/callback', async (req, res) => {
    if (!AUTH_GITHUB_CLIENT_ID || !AUTH_GITHUB_CLIENT_SECRET)
      return res.status(503).send('GitHub App not configured');
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
          client_id: AUTH_GITHUB_CLIENT_ID,
          client_secret: AUTH_GITHUB_CLIENT_SECRET,
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

      const existing = await db('users').where({ github_id: ghUser.id }).first();
      let userId;

      if (existing) {
        await app.service('users').patch(
          existing.id,
          {
            username: ghUser.login,
            avatar_url: ghUser.avatar_url,
            access_token: accessToken,
            ...(ghUser.email ? { email: ghUser.email } : {}),
          },
          {} // internal call
        );
        userId = existing.id;
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
          },
          {} // internal call
        );
        userId = created.id;
      }

      res.cookie('userId', String(userId), {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      // Authorizing as part of an App install: the repo list just changed.
      if (setupAction || installationId) await invalidateRepoCaches(userId);

      finishRedirect(req, res);
    } catch (err) {
      logger.error(err, 'GitHub auth error');
      res.status(500).send('Authentication failed');
    }
  });

  router.get('/auth/me', async (req, res) => {
    // Sent regardless of sign-in state so the login screen can explain what it is connecting to.
    const github = { install_url: GITHUB_APP_INSTALL_URL };
    const userId = req.signedCookies?.userId;
    if (!userId) return res.json({ user: null, github });

    const user = await db('users').where({ id: userId }).first();
    if (!user) return res.json({ user: null, github });

    res.json({
      github,
      user: {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
        approved: !!user.approved,
        builder_modal_mode: !!user.builder_modal_mode,
        onboarding_completed: !!user.onboarding_completed,
      },
    });
  });

  // Signs a proxy token for the given service subdomain and redirects there.
  // Used by the dev-proxy middleware when the user has no baguette_proxy cookie.
  router.get('/auth/proxy', async (req, res, _next) => {
    const userId = req.signedCookies?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const service = req.query.service;
    if (!service) return res.status(400).json({ error: 'Missing service parameter' });

    const token = signProxyToken(userId);
    const { protocol, hostname } = new URL(PUBLIC_API_URL);

    const redirectToParam = req.query.redirectTo
      ? `&redirectTo=${encodeURIComponent(req.query.redirectTo)}`
      : '';
    const authUrl = `${protocol}//${buildSessionHostname(hostname, service)}/_baguette/auth?sign=${token}${redirectToParam}`;
    return res.redirect(authUrl);
  });

  router.post('/auth/logout', (req, res) => {
    res.clearCookie('userId');
    res.json({ ok: true });
  });

  return router;
}
