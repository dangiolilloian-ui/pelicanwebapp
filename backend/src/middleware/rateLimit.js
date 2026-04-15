// Tiny in-memory rate limiter.  Pelican runs as a single Node process per
// org instance, so an in-process Map is good enough — no Redis needed.
// If we ever scale horizontally, swap this out for an upstream limit at the
// reverse proxy (nginx `limit_req`) rather than bolting a shared store on.
//
// Semantics: a rolling fixed window keyed by (prefix, identifier).  Each hit
// bumps a counter; once the counter exceeds `max` in `windowMs`, we return
// 429 until the window rolls.  Lockout is intentionally soft — we tell the
// caller how long to wait rather than banning them outright.

const buckets = new Map();

// Cleanup: prune expired entries on a lazy timer so the Map doesn't grow
// unbounded.  Every 5 minutes is fine for login-scale traffic.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets.entries()) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

function rateLimit({ windowMs, max, keyPrefix = 'rl', keyFn }) {
  return (req, res, next) => {
    const ident = keyFn ? keyFn(req) : req.ip;
    const key = `${keyPrefix}:${ident}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retrySec = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retrySec));
      return res.status(429).json({
        error: `Too many attempts. Try again in ${retrySec}s.`,
      });
    }
    next();
  };
}

module.exports = { rateLimit };
