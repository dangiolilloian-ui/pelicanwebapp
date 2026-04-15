const prisma = require('../config/db');
const { pushToUser, pushToUsers } = require('./webpush');

// Every in-app notification also fires a browser push so employees get the
// alert on a locked phone.  Push is best-effort — its failures never stop
// the DB write from succeeding, and pushToUser/pushToUsers swallow their
// own errors and prune dead subscriptions.

async function notify(userId, { type, title, body, link }) {
  try {
    const row = await prisma.notification.create({
      data: { userId, type, title, body, link },
    });
    pushToUser(userId, { type, title, body, link }).catch(() => {});
    return row;
  } catch (err) {
    console.error('notify failed', err);
    return null;
  }
}

async function notifyMany(userIds, data) {
  if (!userIds || userIds.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, ...data })),
    });
  } catch (err) {
    console.error('notifyMany failed', err);
  }
  // Fire pushes after the DB write is committed so a failed batch insert
  // doesn't leave users with a push for a notification they can't see in
  // the app.
  pushToUsers(userIds, {
    type: data.type,
    title: data.title,
    body: data.body,
    link: data.link,
  }).catch(() => {});
}

module.exports = { notify, notifyMany };
