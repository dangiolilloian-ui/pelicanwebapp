const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET;

// Cache active-status lookups so we're not hitting the DB on every request.
// 30s window is short enough that a freshly-deactivated user loses access
// within half a minute, and long enough that a logged-in user isn't paying
// the DB roundtrip on every tab switch.
const activeCache = new Map(); // userId -> { ok: boolean, expiresAt: number }
const CACHE_MS = 30 * 1000;

async function isUserActive(userId) {
  const now = Date.now();
  const hit = activeCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.ok;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  // Missing user -> treat as inactive. Forces a stale-session cleanup rather
  // than returning a misleading 200.
  const ok = !!u?.isActive;
  activeCache.set(userId, { ok, expiresAt: now + CACHE_MS });
  return ok;
}

// Manually flush the cache entry for a user the moment we deactivate them —
// the deactivate endpoint calls this so the target's existing session stops
// working immediately instead of having to wait out the TTL.
function invalidateActiveCache(userId) {
  activeCache.delete(userId);
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  // Also accept ?token= query param for img/link sources that can't set headers
  const queryToken = req.query.token;
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;

  if (!raw) {
    return res.status(401).json({ error: 'Token required' });
  }

  let payload;
  try {
    payload = jwt.verify(raw, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Enforce the deactivated-user block here so every authenticated route
  // picks it up for free. The error code lets the frontend differentiate
  // "your token is bad" from "your account has been disabled" and surface a
  // proper message instead of a generic "please log in again".
  try {
    const ok = await isUserActive(payload.id);
    if (!ok) {
      return res.status(401).json({ error: 'Account deactivated', code: 'DEACTIVATED' });
    }
  } catch (err) {
    console.error('[authenticate] isActive lookup failed:', err);
    return res.status(500).json({ error: 'Auth check failed' });
  }

  req.user = payload;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, invalidateActiveCache };
