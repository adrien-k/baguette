import { Router } from 'express';
import logger from '../logger.js';
import { PUBLIC_HOST } from '../config.js';
import { buildAuthorizeUrl, oauthAccess, slackRedirectUri } from '../services/slack.js';
import {
  looksLikeSlackSignature,
  readSlackToken,
  signSlackToken,
  verifySlackSignature,
} from '../services/slack-auth.js';
import { slackUserName } from '../services/slack-users.js';

// Bad requests to the unauthenticated events endpoint per client, so junk can't be sent forever.
const EVENTS_FAILURE_WINDOW_MS = 60_000;
const EVENTS_FAILURES_PER_WINDOW = 30;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h2>${escapeHtml(title)}</h2>${body}</body>`;
}

/**
 * Slack endpoints. These stay Express routes (not Feathers services) because Slack posts signed
 * raw bodies and the install / link flows are browser redirects.
 */
export default function createSlackRoutes(app, bot) {
  const router = Router();
  const findSlackApp = (id) =>
    app
      .service('admin/slack')
      .get(id)
      .catch(() => null);

  /** Cookie user for browser flows; returns null when signed out so we can explain instead of 401. */
  async function currentUser(req) {
    const userId = req.signedCookies?.userId;
    if (!userId) return null;
    try {
      const user = await app.service('users').get(userId, {});
      return user?.approved ? user : null;
    } catch {
      return null;
    }
  }

  const signInPage = (res) =>
    res
      .status(401)
      .send(
        page(
          'Log in to Baguette',
          `<p>Log in to Baguette, then open this link again.</p><p><a href="${escapeHtml(PUBLIC_HOST)}">Open Baguette</a></p>`
        )
      );

  const eventFailures = new Map(); // client → { count, resetAt }
  const tooManyFailures = (client) => {
    const entry = eventFailures.get(client);
    return Boolean(
      entry && entry.resetAt > Date.now() && entry.count >= EVENTS_FAILURES_PER_WINDOW
    );
  };
  const noteFailure = (client) => {
    const now = Date.now();
    for (const [key, entry] of eventFailures) if (entry.resetAt <= now) eventFailures.delete(key);
    const entry = eventFailures.get(client) ?? {
      count: 0,
      resetAt: now + EVENTS_FAILURE_WINDOW_MS,
    };
    entry.count += 1;
    eventFailures.set(client, entry);
  };

  router.post('/api/slack/events', async (req, res) => {
    const client = req.ip ?? 'unknown';
    if (tooManyFailures(client)) return res.status(429).json({ error: 'too many requests' });
    const reject = () => {
      noteFailure(client);
      return res.status(401).json({ error: 'invalid signature' });
    };

    const body = req.body ?? {};
    const timestamp = req.get('x-slack-request-timestamp');
    const signature = req.get('x-slack-signature');
    // Reject what can't be a Slack request before touching the database or any secret.
    if (!looksLikeSlackSignature({ timestamp, signature }) || !req.rawBody) return reject();

    const slackApp = await bot.findAppByApiAppId(body.api_app_id).catch(() => null);
    const valid =
      slackApp &&
      verifySlackSignature({
        signingSecret: slackApp.signing_secret,
        timestamp,
        signature,
        rawBody: req.rawBody,
      });
    if (!valid) return reject();

    if (body.type === 'url_verification') return res.json({ challenge: body.challenge });

    // Acknowledge first: Slack retries anything slower than 3s, and a session takes longer.
    res.status(200).end();
    if (req.get('x-slack-retry-num')) return;
    if (body.type !== 'event_callback') return;
    bot
      .handleEventCallback(slackApp, body)
      .catch((err) => logger.error({ err }, 'slack: event handling failed'));
  });

  router.get('/api/slack/install', async (req, res) => {
    const user = await currentUser(req);
    if (!user) return signInPage(res);
    const row = await findSlackApp(Number(req.query.app_id));
    if (!row?.client_id) {
      return res
        .status(400)
        .send(page('Slack app not ready', '<p>Save the Slack client ID and secret first.</p>'));
    }
    const state = signSlackToken({ kind: 'install', app_id: row.id, user_id: user.id });
    res.redirect(
      buildAuthorizeUrl({ clientId: row.client_id, redirectUri: slackRedirectUri(), state })
    );
  });

  router.get('/api/slack/oauth/callback', async (req, res) => {
    const user = await currentUser(req);
    if (!user) return signInPage(res);
    const state = readSlackToken(req.query.state);
    if (state?.kind !== 'install' || state.user_id !== user.id) {
      return res
        .status(400)
        .send(page('Install link expired', '<p>Start the install again from Baguette.</p>'));
    }
    if (req.query.error) {
      return res
        .status(400)
        .send(page('Slack install cancelled', `<p>${escapeHtml(req.query.error)}</p>`));
    }
    try {
      const slackApp = await app.service('admin/slack').get(state.app_id);
      const access = await oauthAccess({
        clientId: slackApp.client_id,
        clientSecret: slackApp.client_secret,
        code: String(req.query.code),
        redirectUri: slackRedirectUri(),
      });
      await app.service('admin/slack').saveInstall(slackApp.id, access);
      res.redirect(`${PUBLIC_HOST}/settings/integrations`);
    } catch (err) {
      logger.error({ err }, 'slack: oauth callback failed');
      res.status(500).send(page('Slack install failed', `<p>${escapeHtml(err.message)}</p>`));
    }
  });

  /** The Slack app and user a link token is for; null if the token is bad or the app is gone. */
  async function readLinkToken(token) {
    const link = readSlackToken(token);
    if (!link?.slack_app_id || !link?.slack_user_id) return null;
    const slackApp = await findSlackApp(link.slack_app_id);
    return slackApp ? { slackApp, slackUserId: link.slack_user_id } : null;
  }

  const expiredLinkPage = (res) =>
    res
      .status(400)
      .send(page('Link expired', '<p>Tag the bot in Slack again to get a fresh link.</p>'));

  // Linking needs a click: a link someone forwards must not connect *their* Slack identity to
  // whoever happens to open it, so the page says whose Slack account this is and asks.
  router.get('/api/slack/link', async (req, res) => {
    const user = await currentUser(req);
    if (!user) return signInPage(res);
    const link = await readLinkToken(req.query.token);
    if (!link) return expiredLinkPage(res);

    const name = await slackUserName(link.slackApp.bot_token, link.slackUserId);
    const who = name ? `${name} (${link.slackUserId})` : link.slackUserId;
    res.send(
      page(
        'Connect your Slack account?',
        `<p>Connect the Slack user <strong>${escapeHtml(who)}</strong> to your Baguette account ` +
          `<strong>${escapeHtml(user.username)}</strong>?</p>` +
          '<p>From then on, when that Slack user tags the bot, sessions run as you — with your ' +
          'repositories and GitHub access. Only continue if that Slack account is yours.</p>' +
          '<form method="post" action="/api/slack/link">' +
          `<input type="hidden" name="token" value="${escapeHtml(req.query.token)}">` +
          '<button type="submit" style="font-size:1rem;padding:.5rem 1rem">Connect</button></form>'
      )
    );
  });

  router.post('/api/slack/link', async (req, res) => {
    const user = await currentUser(req);
    if (!user) return signInPage(res);
    const link = await readLinkToken(req.body?.token);
    if (!link) return expiredLinkPage(res);

    await app.service('admin/slack').linkUser({
      slack_app_id: link.slackApp.id,
      slack_user_id: link.slackUserId,
      user_id: user.id,
    });
    res.send(
      page(
        'Slack connected',
        '<p>Your Slack account is linked to Baguette. Head back to Slack and tag the bot to start working.</p>'
      )
    );
  });

  return router;
}
