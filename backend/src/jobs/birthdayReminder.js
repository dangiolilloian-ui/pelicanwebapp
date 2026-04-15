const cron = require('node-cron');
const prisma = require('../config/db');
const { notifyMany } = require('../lib/notify');

// Birthday reminder.
//
// Runs once a day (early morning org time) and nudges managers when an
// employee's birthday is within LOOKAHEAD_DAYS. The goal isn't HR-grade —
// just a "grab a cake" reminder. We intentionally don't tell the employee
// themselves, and we don't fire anything on the day-of: the whole point is
// giving the manager a few days of heads-up.
//
// Dedup: because the job runs daily, we'll hit the same upcoming birthday
// multiple days in a row. That's fine — the manager can mute the push if
// they want. Keeping state for dedup would mean a new table and the juice
// isn't worth the squeeze.

const LOOKAHEAD_DAYS = parseInt(process.env.BIRTHDAY_LOOKAHEAD_DAYS || '7', 10);

function daysUntilBirthday(birthDate, now) {
  const bd = new Date(birthDate);
  const thisYear = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
  if (thisYear < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    // Birthday already passed this year — look at next year.
    thisYear.setFullYear(now.getFullYear() + 1);
  }
  const ms = thisYear.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

async function sendBirthdayReminders() {
  const now = new Date();

  const users = await prisma.user.findMany({
    where: { birthDate: { not: null } },
    select: { id: true, firstName: true, lastName: true, birthDate: true, organizationId: true },
  });
  if (users.length === 0) return;

  // Group upcoming birthdays by org so each org's managers get one digest
  // push covering everyone rather than N separate notifications.
  const byOrg = new Map();
  for (const u of users) {
    const days = daysUntilBirthday(u.birthDate, now);
    if (days <= LOOKAHEAD_DAYS && days >= 1) {
      if (!byOrg.has(u.organizationId)) byOrg.set(u.organizationId, []);
      byOrg.get(u.organizationId).push({ user: u, days });
    }
  }
  if (byOrg.size === 0) return;

  for (const [orgId, list] of byOrg.entries()) {
    const managers = await prisma.user.findMany({
      where: { organizationId: orgId, role: { in: ['OWNER', 'MANAGER'] } },
      select: { id: true },
    });
    if (managers.length === 0) continue;

    list.sort((a, b) => a.days - b.days);
    const lines = list.map(({ user, days }) => {
      const label = days === 1 ? 'tomorrow' : `in ${days} days`;
      return `${user.firstName} ${user.lastName} (${label})`;
    });

    await notifyMany(managers.map((m) => m.id), {
      type: 'BIRTHDAY_REMINDER',
      title: list.length === 1 ? 'Upcoming birthday' : `${list.length} upcoming birthdays`,
      body: lines.slice(0, 3).join(', ') + (lines.length > 3 ? `, +${lines.length - 3} more` : ''),
      link: '/dashboard/team',
    });
  }

  console.log('[birthday] pushed reminders for ' + byOrg.size + ' org(s)');
}

function startBirthdayReminderJob() {
  // 08:00 every day. Managers get the push first thing in the morning,
  // which is when they're most likely to act on it.
  cron.schedule('0 8 * * *', () => {
    sendBirthdayReminders().catch((err) => console.error('[birthday] tick failed', err));
  });
  console.log('[birthday] scheduler started (lookahead: ' + LOOKAHEAD_DAYS + 'd, 08:00 daily)');
}

module.exports = { startBirthdayReminderJob, sendBirthdayReminders };
