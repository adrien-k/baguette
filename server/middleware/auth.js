/**
 * Express middleware: requires signed userId cookie and sets req.user with decrypted
 * secrets (same shape as cookieAuthMiddleware). Uses the Feathers users service so
 * access_token is available to routes — raw SQL rows only have *_encrypted.
 */
export function createRequireAuth(app) {
  return async function requireAuth(req, res, next) {
    const userId = req.signedCookies?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.user && String(req.user.id) === String(userId) && req.user.approved) {
      return next();
    }

    try {
      const user = await app.service('users').get(userId, {});
      if (!user) {
        res.clearCookie('userId');
        return res.status(401).json({ error: 'User not found' });
      }
      if (!user.approved) {
        return res.status(403).json({ error: 'Account pending approval' });
      }
      req.user = user;
      next();
    } catch (err) {
      if (err.code === 404 || err.name === 'NotFound') {
        res.clearCookie('userId');
        return res.status(401).json({ error: 'User not found' });
      }
      next(err);
    }
  };
}
