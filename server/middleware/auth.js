/**
 * Express middleware for API routes that must never be reachable by a pending account.
 * Identity is resolved centrally by cookieAuthMiddleware:
 *   req.user        — approved, may proceed,
 *   req.pendingUser — signed in but unapproved: only the pending page may be served,
 *   neither         — anonymous, a stale cookie pointing at a deleted user, or a lookup
 *                     that failed transiently (req.identityLookupError is set then).
 */
export function createRequireAuth() {
  return function requireAuth(req, res, next) {
    if (req.pendingUser) {
      return res.status(403).json({ error: 'Account pending approval' });
    }
    if (req.user) return next();
    const userId = req.signedCookies?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (req.identityLookupError) {
      // Transient lookup failure: keep the session cookie and surface the error (500)
      // instead of treating the operator as signed out.
      return next(req.identityLookupError);
    }
    // The cookie points at a user that no longer exists — clear it so the next
    // sign-in starts fresh.
    res.clearCookie('userId');
    return res.status(401).json({ error: 'User not found' });
  };
}
