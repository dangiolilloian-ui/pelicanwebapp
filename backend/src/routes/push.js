const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { pushToUser } = require('../lib/webpush');

const router = Router();

// Public key is fetched by the frontend before calling `pushManager.subscribe`.
// We expose it even on the unauthenticated surface because it's public by
// design (that's why it's called a public key) — gating it behind auth just
// forces the service worker to juggle a token it doesn't need.
router.get('/public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// Register (or re-register) this browser for push.  We upsert on endpoint so
// re-subscribing after permission changes or a different user on the same
// device doesn't leave dangling rows.
router.post('/subscribe', authenticate, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint and keys.p256dh + keys.auth are required' });
  }

  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: req.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.headers['user-agent']?.slice(0, 255) || null,
    },
    // On re-subscribe we also re-bind to the current user — handy when a
    // shared device is now being used by a different employee.
    update: {
      userId: req.user.id,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.headers['user-agent']?.slice(0, 255) || null,
    },
  });

  res.status(201).json({ id: sub.id });
});

// Unsubscribe — client passes the endpoint it wants to forget.  We also
// allow a userId-only wipe for "sign out on all devices" flows (not wired in
// the UI yet, but cheap to expose).
router.post('/unsubscribe', authenticate, async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: req.user.id },
    });
  } else {
    await prisma.pushSubscription.deleteMany({ where: { userId: req.user.id } });
  }
  res.json({ ok: true });
});

// Manual test button — fires a push to the current user so they can verify
// end-to-end without waiting for a real shift-publish event.
router.post('/test', authenticate, async (req, res) => {
  // Count subscriptions before sending so we can diagnose issues
  const subCount = await prisma.pushSubscription.count({ where: { userId: req.user.id } });
  const result = await pushToUser(req.user.id, {
    type: 'TEST',
    title: 'Pelican test notification',
    body: 'If you can see this, push is working.',
    link: '/dashboard/today',
  });
  res.json({ ...result, subscriptions: subCount });
});

module.exports = router;
