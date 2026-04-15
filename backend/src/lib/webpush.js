// Thin wrapper around the `web-push` package.  Two responsibilities:
//  1. Configure VAPID once on boot (idempotent — missing keys just disable push)
//  2. Expose `pushToUser(userId, payload)` that fans out to every device the
//     user has registered, and garbage-collects expired subscriptions.
//
// We deliberately keep the payload small — Chrome caps total encrypted body
// at ~4 KB and some services are stricter.  The UI only needs title/body/link.

const webpush = require('web-push');
const prisma = require('../config/db');

let configured = false;

function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) {
    console.warn('[push] VAPID keys missing — push notifications disabled');
    return;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  console.log('[push] VAPID configured');
}

configure();

async function pushToUser(userId, payload) {
  if (!configured) return { sent: 0, pruned: 0 };
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  const toDelete = [];

  // Send in parallel but isolate failures — one dead subscription must not
  // block delivery to the user's other devices.
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body
        );
        sent++;
      } catch (err) {
        // 404 / 410 mean the subscription is dead — prune it so we don't
        // keep hammering a nonexistent endpoint.  Anything else we just
        // log; transient errors will retry on the next push.
        if (err.statusCode === 404 || err.statusCode === 410) {
          toDelete.push(s.id);
        } else {
          console.warn(`[push] send failed (${err.statusCode || err.code}):`, err.body || err.message);
        }
      }
    })
  );

  if (toDelete.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: toDelete } } });
  }

  return { sent, pruned: toDelete.length };
}

async function pushToUsers(userIds, payload) {
  const results = await Promise.all(userIds.map((id) => pushToUser(id, payload)));
  return results.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, pruned: acc.pruned + r.pruned }),
    { sent: 0, pruned: 0 }
  );
}

module.exports = { pushToUser, pushToUsers };
