import { Router } from 'express';
import { PUBLIC_HOST } from '../config.js';
import logger from '../logger.js';

function settingsRedirect(status, message) {
  const back = new URL('/settings', PUBLIC_HOST);
  back.searchParams.set('tab', 'integrations');
  back.searchParams.set('mcp_oauth', status);
  if (message) back.searchParams.set('mcp_error', String(message).slice(0, 300));
  return back.toString();
}

export default function createMcpOAuthRoutes(app) {
  const router = Router();

  router.get('/auth/mcp/callback', async (req, res) => {
    const oauthError = req.query.error;
    if (oauthError) {
      const description = req.query.error_description || oauthError;
      return res.redirect(settingsRedirect('error', description));
    }
    try {
      if (!req.user?.id) {
        return res.redirect(settingsRedirect('error', 'Sign in to finish connecting this server'));
      }
      await app
        .service('mcp-servers')
        .completeOAuth({ code: req.query.code, state: req.query.state }, { user: req.user });
      return res.redirect(settingsRedirect('ok'));
    } catch (err) {
      logger.warn({ err: err?.message }, 'MCP OAuth callback failed');
      return res.redirect(settingsRedirect('error', err?.message || 'OAuth failed'));
    }
  });

  return router;
}
